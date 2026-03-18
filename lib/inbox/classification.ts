import { createHash } from "node:crypto";

import OpenAI from "openai";

import { BucketKind, type Prisma } from "@/generated/prisma/client";
import {
  type LoadedInboxStatePayload,
  selectCompatibleInboxStatePayload,
} from "@/lib/inbox/cache-helpers";
import {
  getEmailThreads,
  listRecentInboxThreadIds,
  type EmailThreadSummary,
} from "@/lib/google-workspace/gmail";
import { getWorkspaceInboxThreadLimit } from "@/lib/google-workspace/inbox-thread-limit";
import { prisma } from "@/lib/prisma";
import { upsertAppUser } from "@/lib/users";

const DEFAULT_BUCKETS = [
  {
    description:
      "Use Important for urgent, time-sensitive, or high-consequence threads that likely need prompt attention from the user.",
    name: "Important",
  },
  {
    description:
      "Use Can wait for legitimate threads that matter but are not urgent and can be reviewed later without risk.",
    name: "Can wait",
  },
  {
    description:
      "Use Auto-archive for routine automated updates, completed flows, notifications, and low-value mail that rarely needs follow-up.",
    name: "Auto-archive",
  },
  {
    description:
      "Use Newsletter for recurring subscription, promotional, editorial, digest, or marketing-style messages.",
    name: "Newsletter",
  },
  {
    description:
      "Use Finance for banking, billing, payroll, taxes, invoices, receipts, reimbursements, and other money-related threads.",
    name: "Finance",
  },
  {
    description:
      "Use Personal for direct human correspondence from friends, family, or close personal contacts rather than businesses or bulk senders.",
    name: "Personal",
  },
] as const;

const DEFAULT_BUCKET_NAMES = new Set<string>(
  DEFAULT_BUCKETS.map((bucket) => bucket.name),
);
const DEFAULT_BUCKET_ORDER = DEFAULT_BUCKETS.map((bucket) => bucket.name) as string[];
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

const apiKey = process.env.OPENAI_API_KEY;
const model = process.env.OPENAI_MODEL;
const openAIClient = apiKey ? new OpenAI({ apiKey }) : null;

type BucketRecord = {
  createdAt: Date;
  description: string | null;
  id: string;
  kind: BucketKind;
  name: string;
  sortOrder: number;
};

export type BucketSetting = {
  id: string;
  isCustom: boolean;
  name: string;
  prompt: string;
};

type ThreadSignals = {
  automatedSender: boolean;
  financeSignals: boolean;
  freeMailSender: boolean;
  importantSignals: boolean;
  marketingSignals: boolean;
  senderDomain: string | null;
};

type FinalClassification = {
  bucketNames: string[];
  confidence: number;
  rationale: string;
  source: "fallback" | "heuristic" | "llm";
};

export type InboxThreadItem = {
  bucketNames: string[];
  lastMessageAt: string | null;
  preview: string;
  sender: string | null;
  source: FinalClassification["source"];
  subject: string;
  threadId: string;
};

export type InboxBucketGroup = {
  count: number;
  description: string | null;
  id: string;
  isCustom: boolean;
  name: string;
  threads: InboxThreadItem[];
};

export type InboxHomepageData = {
  bucketCount: number;
  buckets: InboxBucketGroup[];
  configuredThreadLimit: number;
  totalThreads: number;
};

export type InboxLoadTimings = {
  gmailFetchMs: number;
  sortingMs: number;
};

export type InboxLoadResult = {
  emailCacheHit: boolean;
  inbox: InboxHomepageData;
  newThreadCount: number;
  sortingCacheHit: boolean;
  timings: InboxLoadTimings;
};

export type InboxRefreshStatus = {
  checkedAt: string;
  hasUpdates: boolean;
  unsortedThreadCount: number;
};

type CachedThreadSnapshot = {
  body: string;
  fingerprint: string;
  labelIds: string[];
  lastMessageAt: string | null;
  preview: string;
  sender: string | null;
  subject: string;
  threadId: string;
};

type CachedBucketMembership = {
  applies: boolean;
  bucketPromptHash: string;
  confidence: number;
  rationale: string;
  source: FinalClassification["source"];
  threadFingerprint: string;
};

type InboxStatePayload = {
  bucketMembershipsByThreadId: Record<string, Record<string, CachedBucketMembership>>;
  configuredThreadLimit: number;
  threadIds: string[];
  threadsById: Record<string, CachedThreadSnapshot>;
  version: 2;
};

type BucketMembershipClassification = {
  applies: boolean;
  confidence: number;
  rationale: string;
  source: FinalClassification["source"];
};

const INBOX_STATE_CACHE_KEY_PREFIX = "inbox-state-v2";

const MIN_INBOX_CLASSIFICATION_BATCH_SIZE = 1;
const MAX_INBOX_CLASSIFICATION_BATCH_SIZE = 100;
const FALLBACK_INBOX_CLASSIFICATION_BATCH_SIZE = 40;

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

function getBucketPrompt(bucket: BucketRecord) {
  return bucket.description?.trim() || `Use ${bucket.name} when it is the best fit.`;
}

function parseInboxStatePayload(value: unknown): InboxStatePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InboxStatePayload>;

  if (
    candidate.version !== 2 ||
    typeof candidate.configuredThreadLimit !== "number" ||
    !Array.isArray(candidate.threadIds) ||
    !candidate.threadsById ||
    typeof candidate.threadsById !== "object" ||
    !candidate.bucketMembershipsByThreadId ||
    typeof candidate.bucketMembershipsByThreadId !== "object"
  ) {
    return null;
  }

  return candidate as InboxStatePayload;
}

function createEmptyInboxStatePayload(configuredThreadLimit: number): InboxStatePayload {
  return {
    bucketMembershipsByThreadId: {},
    configuredThreadLimit,
    threadIds: [],
    threadsById: {},
    version: 2,
  };
}

function getBucketPromptHash(bucket: BucketRecord) {
  return createHash("sha256").update(getBucketPrompt(bucket)).digest("hex");
}

function getBucketPromptHashes(buckets: BucketRecord[]) {
  return new Map(buckets.map((bucket) => [bucket.id, getBucketPromptHash(bucket)]));
}

function getInboxStateCacheKey(configuredThreadLimit: number) {
  return `${INBOX_STATE_CACHE_KEY_PREFIX}:${configuredThreadLimit}`;
}

function getInboxStateCacheKeyHash(cacheKey: string) {
  return createHash("sha256").update(cacheKey).digest("hex");
}

async function loadInboxStatePayload(ownerId: string, configuredThreadLimit: number) {
  const rows = await prisma.inboxClassificationCache.findMany({
    where: {
      cacheKey: {
        startsWith: INBOX_STATE_CACHE_KEY_PREFIX,
      },
      ownerId,
    },
    select: {
      cacheKey: true,
      payload: true,
      updatedAt: true,
    },
  });
  const compatibleRows = rows
    .flatMap((row) => {
      const payload = parseInboxStatePayload(row.payload);

      if (!payload || payload.configuredThreadLimit < configuredThreadLimit) {
        return [];
      }

      return [
        {
          cacheKey: row.cacheKey,
          payload,
          updatedAt: row.updatedAt,
        },
      ];
    });

  return selectCompatibleInboxStatePayload({
    configuredThreadLimit,
    expectedCacheKey: getInboxStateCacheKey(configuredThreadLimit),
    rows: compatibleRows,
  }) as LoadedInboxStatePayload<CachedThreadSnapshot, CachedBucketMembership> | null;
}

async function saveInboxStatePayload(ownerId: string, payload: InboxStatePayload) {
  const cacheKey = getInboxStateCacheKey(payload.configuredThreadLimit);

  await prisma.inboxClassificationCache.upsert({
    where: {
      ownerId_cacheKeyHash: {
        cacheKeyHash: getInboxStateCacheKeyHash(cacheKey),
        ownerId,
      },
    },
    create: {
      cacheKey,
      cacheKeyHash: getInboxStateCacheKeyHash(cacheKey),
      ownerId,
      payload: payload as Prisma.InputJsonValue,
    },
    update: {
      cacheKey,
      payload: payload as Prisma.InputJsonValue,
    },
  });
}

function summarizeThreadForPreview(thread: EmailThreadSummary) {
  return {
    body: thread.body,
    fingerprint: createHash("sha256")
      .update(
        JSON.stringify({
          body: thread.body,
          labelIds: [...thread.labelIds].sort(),
          lastMessageAt: thread.lastMessageAt,
          sender: thread.sender,
          snippet: thread.snippet,
          subject: thread.subject,
        }),
      )
      .digest("hex"),
    labelIds: [...thread.labelIds].sort(),
    lastMessageAt: thread.lastMessageAt,
    preview: normalizePreview(thread),
    sender: thread.sender,
    subject: thread.subject,
    threadId: thread.id,
  } satisfies CachedThreadSnapshot;
}

function toEmailThreadSummary(snapshot: CachedThreadSnapshot): EmailThreadSummary {
  return {
    body: snapshot.body,
    id: snapshot.threadId,
    labelIds: snapshot.labelIds,
    lastMessageAt: snapshot.lastMessageAt,
    sender: snapshot.sender,
    snippet: snapshot.preview,
    subject: snapshot.subject,
  };
}

function countNewThreadIds(currentThreadIds: string[], cachedThreadIds: string[]) {
  const cachedThreadIdSet = new Set(cachedThreadIds);
  let newThreadCount = 0;

  for (let index = 0; index < currentThreadIds.length; index += 1) {
    const threadId = currentThreadIds[index];

    if (!cachedThreadIdSet.has(threadId)) {
      newThreadCount += 1;
    }
  }

  return newThreadCount;
}

function getBucketSortKey(name: string) {
  const defaultIndex = DEFAULT_BUCKET_ORDER.indexOf(name);

  return defaultIndex === -1 ? Number.MAX_SAFE_INTEGER : defaultIndex;
}

function sortBucketRecordsByDisplayOrder(buckets: BucketRecord[]) {
  return [...buckets].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    const leftRank = getBucketSortKey(left.name);
    const rightRank = getBucketSortKey(right.name);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    if (left.kind !== right.kind) {
      return left.kind === BucketKind.SYSTEM ? -1 : 1;
    }

    return left.name.localeCompare(right.name);
  });
}

function sortBucketNames(
  bucketNames: string[],
  orderedBucketNames: string[] = DEFAULT_BUCKET_ORDER,
) {
  const bucketOrder = new Map(
    orderedBucketNames.map((bucketName, index) => [bucketName, index]),
  );

  return [...bucketNames].sort((left, right) => {
    const leftRank = bucketOrder.get(left) ?? Number.MAX_SAFE_INTEGER;
    const rightRank = bucketOrder.get(right) ?? Number.MAX_SAFE_INTEGER;

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.localeCompare(right);
  });
}

function sortBucketSettingsForDisplay(buckets: BucketRecord[]) {
  return [...buckets].sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }

    if (left.kind !== right.kind) {
      return left.kind === BucketKind.CUSTOM ? -1 : 1;
    }

    if (left.kind === BucketKind.CUSTOM && right.kind === BucketKind.CUSTOM) {
      const createdAtDelta = right.createdAt.getTime() - left.createdAt.getTime();

      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }
    }

    const leftRank = getBucketSortKey(left.name);
    const rightRank = getBucketSortKey(right.name);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.name.localeCompare(right.name);
  });
}

function getInitialBucketSettingsOrder(buckets: BucketRecord[]) {
  return [...buckets].sort((left, right) => {
    if (left.kind !== right.kind) {
      return left.kind === BucketKind.CUSTOM ? -1 : 1;
    }

    if (left.kind === BucketKind.CUSTOM && right.kind === BucketKind.CUSTOM) {
      const createdAtDelta = right.createdAt.getTime() - left.createdAt.getTime();

      if (createdAtDelta !== 0) {
        return createdAtDelta;
      }
    }

    const leftRank = getBucketSortKey(left.name);
    const rightRank = getBucketSortKey(right.name);

    if (leftRank !== rightRank) {
      return leftRank - rightRank;
    }

    return left.name.localeCompare(right.name);
  });
}

async function normalizeBucketSortOrders(ownerId: string, buckets: BucketRecord[]) {
  const uniqueSortOrders = new Set(buckets.map((bucket) => bucket.sortOrder));

  if (uniqueSortOrders.size === buckets.length) {
    return buckets;
  }

  const orderedBuckets = getInitialBucketSettingsOrder(buckets);

  await prisma.$transaction(
    orderedBuckets.map((bucket, index) =>
      prisma.bucket.update({
        where: {
          id: bucket.id,
        },
        data: {
          sortOrder: index,
        },
        select: {
          id: true,
        },
      }),
    ),
  );

  return prisma.bucket.findMany({
    where: {
      ownerId,
    },
    select: {
      createdAt: true,
      description: true,
      id: true,
      kind: true,
      name: true,
      sortOrder: true,
    },
  });
}

function getThreadText(thread: EmailThreadSummary) {
  return `${thread.subject}\n${thread.snippet}\n${thread.sender ?? ""}`.trim();
}

function extractSenderDomain(sender: string | null) {
  if (!sender) {
    return null;
  }

  const matchedAddress = sender.match(/<([^>]+)>/)?.[1] ?? sender.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];

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
        const payload = threadChunk.map((thread) => {
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
        });

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
                    threads: payload,
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

        if (
          typeof entry.threadId !== "string" ||
          !bucketNames.length
        ) {
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
        const payload = threadChunk.map((thread) => {
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
        });

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
                    threads: payload,
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

async function ensureOwnerBuckets(ownerId: string) {
  const existingBuckets = await prisma.bucket.findMany({
    where: {
      ownerId,
    },
    select: {
      createdAt: true,
      description: true,
      id: true,
      kind: true,
      name: true,
      sortOrder: true,
    },
  });
  return sortBucketRecordsByDisplayOrder(
    await normalizeBucketSortOrders(ownerId, existingBuckets),
  );
}

async function restoreDefaultBuckets(ownerId: string) {
  const existingBuckets = await prisma.bucket.findMany({
    where: {
      ownerId,
    },
    select: {
      createdAt: true,
      description: true,
      id: true,
      kind: true,
      name: true,
      sortOrder: true,
    },
  });
  const existingBucketMap = new Map(
    existingBuckets.map((bucket) => [bucket.name.toLocaleLowerCase(), bucket]),
  );
  const nextSortOrderStart =
    existingBuckets.reduce(
      (highestSortOrder, bucket) => Math.max(highestSortOrder, bucket.sortOrder),
      -1,
    ) + 1;
  const operations: Prisma.PrismaPromise<{ id: string }>[] = [];
  let nextSortOrder = nextSortOrderStart;

  for (const bucket of DEFAULT_BUCKETS) {
    const existingBucket = existingBucketMap.get(bucket.name.toLocaleLowerCase());

    if (existingBucket) {
      operations.push(
        prisma.bucket.update({
          where: {
            id: existingBucket.id,
          },
          data: {
            description: bucket.description,
            kind: BucketKind.SYSTEM,
          },
          select: {
            id: true,
          },
        }),
      );
      continue;
    }

    operations.push(
      prisma.bucket.create({
        data: {
          description: bucket.description,
          kind: BucketKind.SYSTEM,
          name: bucket.name,
          ownerId,
          sortOrder: nextSortOrder,
        },
        select: {
          id: true,
        },
      }),
    );
    nextSortOrder += 1;
  }

  await prisma.$transaction(operations);

  return ensureOwnerBuckets(ownerId);
}

function normalizePreview(thread: EmailThreadSummary) {
  return (
    thread.snippet.trim() ||
    thread.body.split("\n").join(" ").slice(0, 220).trim()
  );
}

function getFallbackBucketName(buckets: BucketRecord[]) {
  return (
    buckets.find((bucket) => bucket.name === "Can wait")?.name ??
    buckets[0]?.name ??
    "Can wait"
  );
}

async function classifyThreadsAgainstBuckets(
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
      const mergedBucketNames = sortBucketNames([
        ...new Set([
          ...llmClassification.bucketNames,
          ...(heuristicClassification?.bucketNames ?? []),
        ]),
      ], orderedBucketNames);

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

function setCachedBucketMembership(
  payload: InboxStatePayload,
  threadId: string,
  bucketId: string,
  membership: CachedBucketMembership,
) {
  if (!payload.bucketMembershipsByThreadId[threadId]) {
    payload.bucketMembershipsByThreadId[threadId] = {};
  }

  payload.bucketMembershipsByThreadId[threadId][bucketId] = membership;
}

function applyFullClassificationsToPayload(input: {
  buckets: BucketRecord[];
  classifications: Map<string, FinalClassification>;
  payload: InboxStatePayload;
  threads: EmailThreadSummary[];
}) {
  const bucketPromptHashes = getBucketPromptHashes(input.buckets);

  for (const thread of input.threads) {
    const classification = input.classifications.get(thread.id);
    const snapshot = input.payload.threadsById[thread.id];

    if (!classification || !snapshot) {
      continue;
    }

    const appliedBucketNames = new Set(classification.bucketNames);

    for (const bucket of input.buckets) {
      setCachedBucketMembership(input.payload, thread.id, bucket.id, {
        applies: appliedBucketNames.has(bucket.name),
        bucketPromptHash: bucketPromptHashes.get(bucket.id) ?? "",
        confidence: appliedBucketNames.has(bucket.name)
          ? classification.confidence
          : Math.max(0.05, 1 - classification.confidence),
        rationale: appliedBucketNames.has(bucket.name)
          ? classification.rationale
          : `${bucket.name} did not match as strongly as the selected buckets in the latest classification pass.`,
        source: classification.source,
        threadFingerprint: snapshot.fingerprint,
      });
    }
  }
}

function getThreadSource(memberships: CachedBucketMembership[]) {
  if (memberships.some((membership) => membership.source === "heuristic")) {
    return "heuristic" as const;
  }

  if (memberships.some((membership) => membership.source === "llm")) {
    return "llm" as const;
  }

  return "fallback" as const;
}

function buildHomepageDataFromState(
  buckets: BucketRecord[],
  payload: InboxStatePayload,
): InboxHomepageData {
  const groupedThreads = new Map<string, InboxThreadItem[]>();

  for (const bucket of buckets) {
    groupedThreads.set(bucket.name, []);
  }

  for (const threadId of payload.threadIds) {
    const snapshot = payload.threadsById[threadId];

    if (!snapshot) {
      continue;
    }

    const memberships = buckets
      .map((bucket) => ({
        bucket,
        membership: payload.bucketMembershipsByThreadId[threadId]?.[bucket.id],
      }))
      .filter(
        (entry): entry is {
          bucket: BucketRecord;
          membership: CachedBucketMembership;
        } => Boolean(entry.membership?.applies),
      );

    const bucketNames = sortBucketNames(
      memberships.map((entry) => entry.bucket.name),
      buckets.map((bucket) => bucket.name),
    );

    if (!bucketNames.length) {
      continue;
    }

    const source = getThreadSource(memberships.map((entry) => entry.membership));

    for (const bucketName of bucketNames) {
      groupedThreads.get(bucketName)?.push({
        bucketNames,
        lastMessageAt: snapshot.lastMessageAt,
        preview: snapshot.preview,
        sender: snapshot.sender,
        source,
        subject: snapshot.subject,
        threadId: snapshot.threadId,
      });
    }
  }

  const bucketGroups = buckets.map((bucket) => {
    const bucketThreads = (groupedThreads.get(bucket.name) ?? []).sort((left, right) => {
      const leftTimestamp = left.lastMessageAt ? new Date(left.lastMessageAt).getTime() : 0;
      const rightTimestamp = right.lastMessageAt
        ? new Date(right.lastMessageAt).getTime()
        : 0;

      return rightTimestamp - leftTimestamp;
    });

    return {
      count: bucketThreads.length,
      description: bucket.description,
      id: bucket.id,
      isCustom: bucket.kind === BucketKind.CUSTOM,
      name: bucket.name,
      threads: bucketThreads,
    } satisfies InboxBucketGroup;
  });

  return {
    bucketCount: bucketGroups.length,
    buckets: bucketGroups,
    configuredThreadLimit: payload.configuredThreadLimit,
    totalThreads: payload.threadIds.length,
  };
}

async function ensureBucketMembershipsAreCurrent(
  payload: InboxStatePayload,
  buckets: BucketRecord[],
) {
  const bucketPromptHashes = getBucketPromptHashes(buckets);
  const staleThreadIdsByBucketId = new Map<string, string[]>();

  for (const threadId of payload.threadIds) {
    const snapshot = payload.threadsById[threadId];

    if (!snapshot) {
      continue;
    }

    for (const bucket of buckets) {
      const membership = payload.bucketMembershipsByThreadId[threadId]?.[bucket.id];
      const expectedPromptHash = bucketPromptHashes.get(bucket.id) ?? "";

      if (
        membership &&
        membership.threadFingerprint === snapshot.fingerprint &&
        membership.bucketPromptHash === expectedPromptHash
      ) {
        continue;
      }

      const staleThreadIds = staleThreadIdsByBucketId.get(bucket.id) ?? [];

      staleThreadIds.push(threadId);
      staleThreadIdsByBucketId.set(bucket.id, staleThreadIds);
    }
  }

  if (!staleThreadIdsByBucketId.size) {
    return false;
  }

  for (const bucket of buckets) {
    const staleThreadIds = staleThreadIdsByBucketId.get(bucket.id);

    if (!staleThreadIds?.length) {
      continue;
    }

    const staleThreads = staleThreadIds
      .map((threadId) => payload.threadsById[threadId])
      .filter((thread): thread is CachedThreadSnapshot => Boolean(thread))
      .map(toEmailThreadSummary);
    const resolvedMemberships = new Map<string, BucketMembershipClassification>();
    const threadsNeedingLLM: EmailThreadSummary[] = [];

    for (const thread of staleThreads) {
      const heuristicClassification = classifyWithHeuristics(
        thread,
        detectSignals(thread),
        new Set([bucket.name]),
      );

      if (heuristicClassification?.bucketNames.includes(bucket.name)) {
        resolvedMemberships.set(thread.id, {
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
      bucket,
      buckets,
    );

    for (const thread of staleThreads) {
      const snapshot = payload.threadsById[thread.id];
      const membership =
        resolvedMemberships.get(thread.id) ??
        llmMemberships.get(thread.id) ?? {
          applies: false,
          confidence: 0.2,
          rationale: `No strong evidence was found for the ${bucket.name} bucket.`,
          source: "fallback" as const,
        };

      setCachedBucketMembership(payload, thread.id, bucket.id, {
        applies: membership.applies,
        bucketPromptHash: bucketPromptHashes.get(bucket.id) ?? "",
        confidence: membership.confidence,
        rationale: membership.rationale,
        source: membership.source,
        threadFingerprint: snapshot?.fingerprint ?? "",
      });
    }
  }

  return true;
}

async function synchronizeInboxStateFromGmail(input: {
  accessToken: string;
  buckets: BucketRecord[];
  existingPayload: InboxStatePayload | null;
  inboxThreadLimit: number;
}) {
  const threadIds = await listRecentInboxThreadIds(input.accessToken, {
    maxResults: input.inboxThreadLimit,
  });
  const threads = await getEmailThreads(input.accessToken, threadIds);
  const payload = createEmptyInboxStatePayload(input.inboxThreadLimit);
  const threadsNeedingFullClassification: EmailThreadSummary[] = [];
  const newThreadCount = countNewThreadIds(
    threadIds,
    input.existingPayload?.threadIds ?? [],
  );

  payload.threadIds = threadIds;

  for (const thread of threads) {
    const snapshot = summarizeThreadForPreview(thread);
    const existingSnapshot = input.existingPayload?.threadsById[thread.id];
    const existingMemberships =
      existingSnapshot?.fingerprint === snapshot.fingerprint
        ? input.existingPayload?.bucketMembershipsByThreadId[thread.id] ?? {}
        : {};

    payload.threadsById[thread.id] = snapshot;
    payload.bucketMembershipsByThreadId[thread.id] = { ...existingMemberships };

    if (!existingSnapshot || existingSnapshot.fingerprint !== snapshot.fingerprint) {
      threadsNeedingFullClassification.push(thread);
    }
  }

  if (threadsNeedingFullClassification.length) {
    const classifications = await classifyThreadsAgainstBuckets(
      threadsNeedingFullClassification,
      input.buckets,
    );

    applyFullClassificationsToPayload({
      buckets: input.buckets,
      classifications,
      payload,
      threads: threadsNeedingFullClassification,
    });
  }

  const hadMembershipUpdates = await ensureBucketMembershipsAreCurrent(
    payload,
    input.buckets,
  );

  return {
    newThreadCount,
    payload,
    reclassified:
      hadMembershipUpdates || threadsNeedingFullClassification.length > 0,
  };
}

export async function createCustomBucket(input: {
  name: string;
  prompt?: string;
  ownerEmail: string;
  ownerImage?: string | null;
  ownerName?: string | null;
}) {
  const trimmedName = input.name.trim().replace(/\s+/g, " ");

  if (!trimmedName) {
    throw new Error("Bucket name is required.");
  }

  const owner = await upsertAppUser({
    email: input.ownerEmail,
    image: input.ownerImage,
    name: input.ownerName,
  });

  await ensureOwnerBuckets(owner.id);

  const earliestBucket = await prisma.bucket.findFirst({
    where: {
      ownerId: owner.id,
    },
    orderBy: {
      sortOrder: "asc",
    },
    select: {
      sortOrder: true,
    },
  });

  const existingBucket = await prisma.bucket.findFirst({
    where: {
      ownerId: owner.id,
      name: {
        equals: trimmedName,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
    },
  });

  if (existingBucket) {
    return existingBucket.id;
  }

  const bucket = await prisma.bucket.create({
    data: {
      description: input.prompt?.trim() || null,
      kind: DEFAULT_BUCKET_NAMES.has(trimmedName)
        ? BucketKind.SYSTEM
        : BucketKind.CUSTOM,
      name: trimmedName,
      ownerId: owner.id,
      sortOrder: (earliestBucket?.sortOrder ?? 0) - 1,
    },
    select: {
      id: true,
    },
  });

  return bucket.id;
}

export async function listBucketSettings(input: {
  ownerEmail: string;
  ownerImage?: string | null;
  ownerName?: string | null;
}) {
  const owner = await upsertAppUser({
    email: input.ownerEmail,
    image: input.ownerImage,
    name: input.ownerName,
  });
  const buckets = sortBucketSettingsForDisplay(await ensureOwnerBuckets(owner.id));

  return buckets.map(
    (bucket) =>
      ({
        id: bucket.id,
        isCustom: bucket.kind === BucketKind.CUSTOM,
        name: bucket.name,
        prompt: bucket.description ?? "",
      }) satisfies BucketSetting,
  );
}

export async function updateBucketPrompt(input: {
  bucketId: string;
  ownerEmail: string;
  prompt: string;
}) {
  const owner = await prisma.user.findUnique({
    where: {
      email: input.ownerEmail,
    },
    select: {
      id: true,
    },
  });

  if (!owner) {
    throw new Error("Bucket owner not found.");
  }

  const trimmedPrompt = input.prompt.trim();

  const result = await prisma.bucket.updateMany({
    where: {
      id: input.bucketId,
      ownerId: owner.id,
    },
    data: {
      description: trimmedPrompt || null,
    },
  });

  if (!result.count) {
    throw new Error("Bucket not found.");
  }

  return listBucketSettings({
    ownerEmail: input.ownerEmail,
  });
}

export async function reorderBucketSettings(input: {
  bucketIds: string[];
  ownerEmail: string;
}) {
  const owner = await prisma.user.findUnique({
    where: {
      email: input.ownerEmail,
    },
    select: {
      id: true,
    },
  });

  if (!owner) {
    throw new Error("Bucket owner not found.");
  }

  const uniqueBucketIds = [...new Set(input.bucketIds)];

  const existingBuckets = await prisma.bucket.findMany({
    where: {
      ownerId: owner.id,
    },
    select: {
      id: true,
    },
  });

  if (uniqueBucketIds.length !== existingBuckets.length) {
    throw new Error("Bucket reorder payload is incomplete.");
  }

  const existingBucketIds = new Set(existingBuckets.map((bucket) => bucket.id));

  if (uniqueBucketIds.some((bucketId) => !existingBucketIds.has(bucketId))) {
    throw new Error("Bucket reorder payload is invalid.");
  }

  await prisma.$transaction(
    uniqueBucketIds.map((bucketId, index) =>
      prisma.bucket.update({
        where: {
          id: bucketId,
        },
        data: {
          sortOrder: index,
        },
        select: {
          id: true,
        },
      }),
    ),
  );

  return listBucketSettings({
    ownerEmail: input.ownerEmail,
  });
}

export async function deleteBucketSetting(input: {
  bucketId: string;
  ownerEmail: string;
}) {
  const owner = await prisma.user.findUnique({
    where: {
      email: input.ownerEmail,
    },
    select: {
      id: true,
    },
  });

  if (!owner) {
    throw new Error("Bucket owner not found.");
  }

  const bucket = await prisma.bucket.findFirst({
    where: {
      id: input.bucketId,
      ownerId: owner.id,
    },
    select: {
      id: true,
    },
  });

  if (!bucket) {
    throw new Error("Bucket not found.");
  }

  await prisma.bucket.delete({
    where: {
      id: bucket.id,
    },
    select: {
      id: true,
    },
  });

  return listBucketSettings({
    ownerEmail: input.ownerEmail,
  });
}

export async function resetDefaultBucketSettings(input: {
  ownerEmail: string;
  ownerImage?: string | null;
  ownerName?: string | null;
}) {
  const owner = await upsertAppUser({
    email: input.ownerEmail,
    image: input.ownerImage,
    name: input.ownerName,
  });

  const buckets = await restoreDefaultBuckets(owner.id);

  return buckets.map(
    (bucket) =>
      ({
        id: bucket.id,
        isCustom: bucket.kind === BucketKind.CUSTOM,
        name: bucket.name,
        prompt: bucket.description ?? "",
      }) satisfies BucketSetting,
  );
}

export async function clearInboxClassificationCache(ownerEmail: string) {
  const owner = await prisma.user.findUnique({
    where: {
      email: ownerEmail,
    },
    select: {
      id: true,
    },
  });

  if (!owner) {
    return 0;
  }

  const result = await prisma.inboxClassificationCache.deleteMany({
    where: {
      ownerId: owner.id,
    },
  });

  return result.count;
}

export async function hasInboxClassificationCache(ownerEmail: string) {
  const owner = await prisma.user.findUnique({
    where: {
      email: ownerEmail,
    },
    select: {
      id: true,
    },
  });

  if (!owner) {
    return false;
  }

  const cacheRowCount = await prisma.inboxClassificationCache.count({
    where: {
      ownerId: owner.id,
    },
  });

  return cacheRowCount > 0;
}

export async function getInboxRefreshStatus(input: {
  accessToken: string;
  ownerEmail: string;
  ownerImage?: string | null;
  ownerName?: string | null;
}): Promise<InboxRefreshStatus> {
  const owner = await upsertAppUser({
    email: input.ownerEmail,
    image: input.ownerImage,
    name: input.ownerName,
  });
  const inboxThreadLimit = await getWorkspaceInboxThreadLimit(input.ownerEmail);
  const cachedState = await loadInboxStatePayload(owner.id, inboxThreadLimit);
  const parsedPayload = cachedState?.payload ?? null;

  if (!parsedPayload) {
    return {
      checkedAt: new Date().toISOString(),
      hasUpdates: false,
      unsortedThreadCount: 0,
    };
  }

  const latestThreadIds = await listRecentInboxThreadIds(input.accessToken, {
    maxResults: inboxThreadLimit,
  });
  const unsortedThreadCount = countNewThreadIds(
    latestThreadIds,
    parsedPayload.threadIds,
  );

  return {
    checkedAt: new Date().toISOString(),
    hasUpdates: unsortedThreadCount > 0,
    unsortedThreadCount,
  };
}

export async function loadInboxHomepage(input: {
  accessToken: string;
  ownerEmail: string;
  ownerImage?: string | null;
  ownerName?: string | null;
  refresh?: boolean;
}): Promise<InboxLoadResult> {
  const owner = await upsertAppUser({
    email: input.ownerEmail,
    image: input.ownerImage,
    name: input.ownerName,
  });
  const buckets = await ensureOwnerBuckets(owner.id);
  const inboxThreadLimit = await getWorkspaceInboxThreadLimit(input.ownerEmail);
  const sortingStartedAt = performance.now();
  const cachedState = await loadInboxStatePayload(owner.id, inboxThreadLimit);
  const cachedPayload = cachedState?.payload ?? null;

  if (cachedPayload && !input.refresh) {
    const hadMembershipUpdates = await ensureBucketMembershipsAreCurrent(
      cachedPayload,
      buckets,
    );

    if (hadMembershipUpdates || cachedState?.requiresSave) {
      await saveInboxStatePayload(owner.id, cachedPayload);
    }

    return {
      emailCacheHit: true,
      inbox: buildHomepageDataFromState(buckets, cachedPayload),
      newThreadCount: 0,
      sortingCacheHit: !hadMembershipUpdates,
      timings: {
        gmailFetchMs: 0,
        sortingMs: Math.round(performance.now() - sortingStartedAt),
      },
    };
  }

  const gmailFetchStartedAt = performance.now();
  const synchronized = await synchronizeInboxStateFromGmail({
    accessToken: input.accessToken,
    buckets,
    existingPayload: cachedPayload,
    inboxThreadLimit,
  });
  const gmailFetchMs = Math.round(performance.now() - gmailFetchStartedAt);

  await saveInboxStatePayload(owner.id, synchronized.payload);

  return {
    emailCacheHit: false,
    inbox: buildHomepageDataFromState(buckets, synchronized.payload),
    newThreadCount: synchronized.newThreadCount,
    sortingCacheHit: !synchronized.reclassified,
    timings: {
      gmailFetchMs,
      sortingMs: Math.round(performance.now() - sortingStartedAt),
    },
  };
}
