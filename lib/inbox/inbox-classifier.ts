import OpenAI from "openai";

import { type EmailThreadSummary } from "@/lib/google-workspace/gmail";
import { getBucketPrompt, sortBucketNames } from "@/lib/inbox/bucket-service";
import {
  BucketMembershipClassification,
  BucketRecord,
  FinalClassification,
  ThreadSignals,
} from "@/lib/inbox/inbox-types";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "icloud.com",
  "me.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const NEWSLETTER_PATTERNS = [
  /\bunsubscribe\b/i,
  /\bnewsletter\b/i,
  /\bdigest\b/i,
  /\bdaily brief\b/i,
  /\bweekly roundup\b/i,
  /\bmarketing\b/i,
  /\bpromotion(al)?\b/i,
  /\bsubstack\b/i,
];

const FINANCE_PATTERNS = [
  /\binvoice\b/i,
  /\breceipt\b/i,
  /\bstatement\b/i,
  /\bbill(ing)?\b/i,
  /\bpayment\b/i,
  /\brefund\b/i,
  /\bpayroll\b/i,
  /\btax(es)?\b/i,
  /\breimbursement\b/i,
  /\bdeposit\b/i,
  /\bsubscription renewal\b/i,
];

const IMPORTANT_PATTERNS = [
  /\burgent\b/i,
  /\basap\b/i,
  /\baction required\b/i,
  /\bresponse needed\b/i,
  /\bfollow up\b/i,
  /\binterview\b/i,
  /\bdeadline\b/i,
  /\bconfirm(ed|ation)?\b/i,
  /\btoday\b/i,
];

const AUTO_ARCHIVE_PATTERNS = [
  /\bshipped\b/i,
  /\bdelivered\b/i,
  /\btracking\b/i,
  /\bpassword reset\b/i,
  /\bsecurity alert\b/i,
  /\bverification code\b/i,
  /\b2fa\b/i,
  /\bnotification\b/i,
  /\breminder\b/i,
  /\bcompleted\b/i,
  /\bsuccessfully\b/i,
];

const AUTOMATED_SENDER_PATTERN =
  /\b(no-?reply|donotreply|notifications?|mailer-daemon|automated|updates?)\b/i;

const MIN_INBOX_CLASSIFICATION_BATCH_SIZE = 1;
const MAX_INBOX_CLASSIFICATION_BATCH_SIZE = 100;
const FALLBACK_INBOX_CLASSIFICATION_BATCH_SIZE = 40;

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
const openAIClient = apiKey ? new OpenAI({ apiKey }) : null;

function getInboxClassificationBatchSize() {
  const rawValue = process.env.INBOX_CLASSIFICATION_BATCH_SIZE;

  if (!rawValue) {
    return FALLBACK_INBOX_CLASSIFICATION_BATCH_SIZE;
  }

  const parsedValue = Number.parseInt(rawValue, 10);

  if (Number.isNaN(parsedValue)) {
    return FALLBACK_INBOX_CLASSIFICATION_BATCH_SIZE;
  }

  return Math.min(
    Math.max(parsedValue, MIN_INBOX_CLASSIFICATION_BATCH_SIZE),
    MAX_INBOX_CLASSIFICATION_BATCH_SIZE,
  );
}

function getThreadText(thread: EmailThreadSummary) {
  return `${thread.subject}\n${thread.snippet}\n${thread.sender ?? ""}`.trim();
}

function extractSenderDomain(sender: string | null) {
  if (!sender) {
    return null;
  }

  const matchedAddress =
    sender.match(/<([^>]+)>/)?.[1] ??
    sender.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];

  if (!matchedAddress) {
    return null;
  }

  const domain = matchedAddress.split("@")[1];

  return domain?.toLowerCase() ?? null;
}

function detectSignals(thread: EmailThreadSummary): ThreadSignals {
  const text = getThreadText(thread);
  const senderDomain = extractSenderDomain(thread.sender);
  const automatedSender =
    AUTOMATED_SENDER_PATTERN.test(thread.sender ?? "") ||
    AUTOMATED_SENDER_PATTERN.test(senderDomain ?? "");

  return {
    automatedSender,
    financeSignals: FINANCE_PATTERNS.some((pattern) => pattern.test(text)),
    freeMailSender: senderDomain ? FREE_EMAIL_DOMAINS.has(senderDomain) : false,
    importantSignals:
      IMPORTANT_PATTERNS.some((pattern) => pattern.test(text)) ||
      thread.labelIds.includes("IMPORTANT") ||
      thread.labelIds.includes("STARRED"),
    marketingSignals:
      NEWSLETTER_PATTERNS.some((pattern) => pattern.test(text)) ||
      thread.labelIds.includes("CATEGORY_PROMOTIONS") ||
      thread.labelIds.includes("CATEGORY_FORUMS"),
    senderDomain,
  };
}

function classifyWithHeuristics(
  thread: EmailThreadSummary,
  signals: ThreadSignals,
  activeBucketNames: Set<string>,
): FinalClassification | null {
  const text = getThreadText(thread);
  const bucketNames: string[] = [];
  const rationaleParts: string[] = [];

  if (
    activeBucketNames.has("Newsletter") &&
    (signals.marketingSignals ||
      (signals.automatedSender && /list-|mailchimp|substack/i.test(thread.sender ?? "")))
  ) {
    bucketNames.push("Newsletter");
    rationaleParts.push(
      "Recurring promotional or editorial subscription signals were detected.",
    );
  }

  if (activeBucketNames.has("Finance") && signals.financeSignals) {
    bucketNames.push("Finance");
    rationaleParts.push("The subject or preview contains strong money-related signals.");
  }

  if (
    activeBucketNames.has("Auto-archive") &&
    (thread.labelIds.includes("SPAM") ||
      thread.labelIds.includes("TRASH") ||
      AUTO_ARCHIVE_PATTERNS.some((pattern) => pattern.test(text)) ||
      (signals.automatedSender && thread.labelIds.includes("CATEGORY_UPDATES")))
  ) {
    bucketNames.push("Auto-archive");
    rationaleParts.push(
      "The thread looks like an automated update that usually does not need follow-up.",
    );
  }

  if (
    activeBucketNames.has("Important") &&
    signals.importantSignals &&
    !signals.marketingSignals
  ) {
    bucketNames.push("Important");
    rationaleParts.push(
      "The thread has urgency or priority signals that suggest prompt attention.",
    );
  }

  if (
    activeBucketNames.has("Personal") &&
    signals.freeMailSender &&
    !signals.automatedSender &&
    !signals.marketingSignals &&
    !signals.financeSignals
  ) {
    bucketNames.push("Personal");
    rationaleParts.push(
      "The sender looks like a direct personal contact instead of a bulk sender.",
    );
  }

  if (bucketNames.length) {
    return {
      bucketNames: sortBucketNames(bucketNames),
      confidence: Math.min(0.99, Math.max(0.82, 0.76 + bucketNames.length * 0.06)),
      rationale: rationaleParts.join(" "),
      source: "heuristic",
    };
  }

  return null;
}

function stripJsonCodeFence(value: string) {
  return value
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function parseClassificationBatch(value: string) {
  try {
    const parsed = JSON.parse(stripJsonCodeFence(value)) as {
      classifications?: Array<{
        bucketNames?: unknown;
        bucketName?: unknown;
        confidence?: unknown;
        rationale?: unknown;
        threadId?: unknown;
      }>;
    };

    return Array.isArray(parsed.classifications) ? parsed.classifications : [];
  } catch {
    return [];
  }
}

function parseBucketMembershipBatch(value: string) {
  try {
    const parsed = JSON.parse(stripJsonCodeFence(value)) as {
      memberships?: Array<{
        applies?: unknown;
        confidence?: unknown;
        rationale?: unknown;
        threadId?: unknown;
      }>;
    };

    return Array.isArray(parsed.memberships) ? parsed.memberships : [];
  } catch {
    return [];
  }
}

function toThreadClassificationPayload(thread: EmailThreadSummary) {
  const signals = detectSignals(thread);

  return {
    labels: thread.labelIds,
    lastMessageAt: thread.lastMessageAt,
    preview: thread.snippet,
    sender: thread.sender,
    senderDomain: signals.senderDomain,
    signals: {
      automatedSender: signals.automatedSender,
      financeSignals: signals.financeSignals,
      freeMailSender: signals.freeMailSender,
      importantSignals: signals.importantSignals,
      marketingSignals: signals.marketingSignals,
    },
    subject: thread.subject,
    threadId: thread.id,
  };
}

async function classifyWithLLM(
  threads: EmailThreadSummary[],
  buckets: BucketRecord[],
): Promise<Map<string, FinalClassification>> {
  const results = new Map<string, FinalClassification>();

  if (!threads.length || !buckets.length || !openAIClient || !model) {
    return results;
  }

  const chunkSize = getInboxClassificationBatchSize();
  const orderedBucketNames = buckets.map((bucket) => bucket.name);
  const allowedBucketNames = new Set(buckets.map((bucket) => bucket.name));
  const threadChunks: EmailThreadSummary[][] = [];

  for (let startIndex = 0; startIndex < threads.length; startIndex += chunkSize) {
    threadChunks.push(threads.slice(startIndex, startIndex + chunkSize));
  }

  try {
    const batchResults = await Promise.allSettled(
      threadChunks.map(async (threadChunk) => {
        const response = await openAIClient.responses.create({
          model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: [
                    "You classify Gmail inbox threads into one or more buckets.",
                    "Use only the provided bucket names.",
                    "A thread may belong in multiple buckets when multiple bucket prompts clearly apply.",
                    "Return every applicable bucket for each thread as a non-empty list.",
                    "If confidence is low, still include the closest applicable bucket names and keep confidence low.",
                    "Follow each bucket prompt closely when deciding which buckets fit.",
                    'Return strict JSON with this shape: {"classifications":[{"threadId":"...","bucketNames":["..."],"confidence":0.0,"rationale":"..."}]}',
                  ].join("\n"),
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    buckets: buckets.map((bucket) => ({
                      prompt: getBucketPrompt(bucket),
                      name: bucket.name,
                    })),
                    threads: threadChunk.map(toThreadClassificationPayload),
                  }),
                },
              ],
            },
          ],
        });

        return parseClassificationBatch(response.output_text);
      }),
    );

    for (const batchResult of batchResults) {
      if (batchResult.status !== "fulfilled") {
        console.error("Inbox LLM classification batch failed", batchResult.reason);
        continue;
      }

      for (const entry of batchResult.value) {
        const rawBucketNames = Array.isArray(entry.bucketNames)
          ? entry.bucketNames
          : typeof entry.bucketName === "string"
            ? [entry.bucketName]
            : [];
        const bucketNames = sortBucketNames(
          [
            ...new Set(
              rawBucketNames.filter(
                (bucketName): bucketName is string =>
                  typeof bucketName === "string" && allowedBucketNames.has(bucketName),
              ),
            ),
          ],
          orderedBucketNames,
        );

        if (typeof entry.threadId !== "string" || !bucketNames.length) {
          continue;
        }

        results.set(entry.threadId, {
          bucketNames,
          confidence:
            typeof entry.confidence === "number"
              ? Math.max(0, Math.min(entry.confidence, 1))
              : 0.5,
          rationale:
            typeof entry.rationale === "string" && entry.rationale.trim().length
              ? entry.rationale.trim()
              : "The classifier chose the closest matching bucket.",
          source: "llm",
        });
      }
    }
  } catch (error) {
    console.error("Inbox LLM classification failed", error);
  }

  return results;
}

async function classifyTargetBucketWithLLM(
  threads: EmailThreadSummary[],
  targetBucket: BucketRecord,
  buckets: BucketRecord[],
): Promise<Map<string, BucketMembershipClassification>> {
  const results = new Map<string, BucketMembershipClassification>();

  if (!threads.length || !openAIClient || !model) {
    return results;
  }

  const chunkSize = getInboxClassificationBatchSize();
  const threadChunks: EmailThreadSummary[][] = [];

  for (let startIndex = 0; startIndex < threads.length; startIndex += chunkSize) {
    threadChunks.push(threads.slice(startIndex, startIndex + chunkSize));
  }

  try {
    const batchResults = await Promise.allSettled(
      threadChunks.map(async (threadChunk) => {
        const response = await openAIClient.responses.create({
          model,
          input: [
            {
              role: "system",
              content: [
                {
                  type: "input_text",
                  text: [
                    "You decide whether each Gmail inbox thread belongs in one target bucket.",
                    "Threads may belong in multiple buckets overall, so judge the target bucket independently.",
                    "Use the full bucket list only for context; return a decision for the target bucket only.",
                    'Return strict JSON with this shape: {"memberships":[{"threadId":"...","applies":true,"confidence":0.0,"rationale":"..."}]}',
                  ].join("\n"),
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "input_text",
                  text: JSON.stringify({
                    buckets: buckets.map((bucket) => ({
                      prompt: getBucketPrompt(bucket),
                      name: bucket.name,
                    })),
                    targetBucket: {
                      name: targetBucket.name,
                      prompt: getBucketPrompt(targetBucket),
                    },
                    threads: threadChunk.map(toThreadClassificationPayload),
                  }),
                },
              ],
            },
          ],
        });

        return parseBucketMembershipBatch(response.output_text);
      }),
    );

    for (const batchResult of batchResults) {
      if (batchResult.status !== "fulfilled") {
        console.error(
          "Inbox targeted bucket classification batch failed",
          batchResult.reason,
        );
        continue;
      }

      for (const entry of batchResult.value) {
        if (typeof entry.threadId !== "string" || typeof entry.applies !== "boolean") {
          continue;
        }

        results.set(entry.threadId, {
          applies: entry.applies,
          confidence:
            typeof entry.confidence === "number"
              ? Math.max(0, Math.min(entry.confidence, 1))
              : 0.5,
          rationale:
            typeof entry.rationale === "string" && entry.rationale.trim().length
              ? entry.rationale.trim()
              : entry.applies
                ? `The thread matches the ${targetBucket.name} bucket.`
                : `The thread does not match the ${targetBucket.name} bucket.`,
          source: "llm",
        });
      }
    }
  } catch (error) {
    console.error("Inbox targeted bucket classification failed", error);
  }

  return results;
}

function getFallbackBucketName(buckets: BucketRecord[]) {
  return (
    buckets.find((bucket) => bucket.name === "Can wait")?.name ??
    buckets[0]?.name ??
    "Can wait"
  );
}

export async function classifyThreadsAgainstBuckets(
  threads: EmailThreadSummary[],
  buckets: BucketRecord[],
) {
  const activeBucketNames = new Set(buckets.map((bucket) => bucket.name));
  const orderedBucketNames = buckets.map((bucket) => bucket.name);
  const classifications = new Map<string, FinalClassification>();
  const heuristicClassifications = new Map<string, FinalClassification>();

  if (!buckets.length) {
    return classifications;
  }

  for (const thread of threads) {
    const heuristicClassification = classifyWithHeuristics(
      thread,
      detectSignals(thread),
      activeBucketNames,
    );

    if (heuristicClassification) {
      heuristicClassifications.set(thread.id, heuristicClassification);
    }
  }

  const llmClassifications = await classifyWithLLM(threads, buckets);
  const fallbackBucketName = getFallbackBucketName(buckets);

  for (const thread of threads) {
    const llmClassification = llmClassifications.get(thread.id);
    const heuristicClassification = heuristicClassifications.get(thread.id);

    if (llmClassification) {
      const mergedBucketNames = sortBucketNames(
        [
          ...new Set([
            ...llmClassification.bucketNames,
            ...(heuristicClassification?.bucketNames ?? []),
          ]),
        ],
        orderedBucketNames,
      );

      classifications.set(thread.id, {
        bucketNames: mergedBucketNames,
        confidence: Math.max(
          llmClassification.confidence,
          heuristicClassification?.confidence ?? 0,
        ),
        rationale: heuristicClassification
          ? `${heuristicClassification.rationale} ${llmClassification.rationale}`.trim()
          : llmClassification.rationale,
        source: heuristicClassification ? "heuristic" : llmClassification.source,
      });
      continue;
    }

    if (heuristicClassification) {
      classifications.set(thread.id, heuristicClassification);
      continue;
    }

    classifications.set(thread.id, {
      bucketNames: [fallbackBucketName],
      confidence: 0.3,
      rationale:
        "No strong signal was found, so the thread was placed in the default low-priority bucket.",
      source: "fallback",
    });
  }

  return classifications;
}

export async function classifyThreadsAgainstBucket(
  threads: EmailThreadSummary[],
  targetBucket: BucketRecord,
  buckets: BucketRecord[],
) {
  const memberships = new Map<string, BucketMembershipClassification>();
  const threadsNeedingLLM: EmailThreadSummary[] = [];

  for (const thread of threads) {
    const heuristicClassification = classifyWithHeuristics(
      thread,
      detectSignals(thread),
      new Set([targetBucket.name]),
    );

    if (heuristicClassification?.bucketNames.includes(targetBucket.name)) {
      memberships.set(thread.id, {
        applies: true,
        confidence: heuristicClassification.confidence,
        rationale: heuristicClassification.rationale,
        source: heuristicClassification.source,
      });
      continue;
    }

    threadsNeedingLLM.push(thread);
  }

  const llmMemberships = await classifyTargetBucketWithLLM(
    threadsNeedingLLM,
    targetBucket,
    buckets,
  );

  for (const [threadId, membership] of llmMemberships) {
    memberships.set(threadId, membership);
  }

  return memberships;
}
