import { createHash } from "node:crypto";

import OpenAI from "openai";

import { BucketKind, type Prisma } from "@/generated/prisma/client";
import type { EmailThreadSummary } from "@/lib/google-workspace/gmail";
import { listRecentInboxThreads } from "@/lib/google-workspace/gmail";
import {
  getDefaultInboxThreadLimit,
  getWorkspaceInboxThreadLimit,
} from "@/lib/google-workspace/inbox-thread-limit";
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
  bucketName: string;
  confidence: number;
  rationale: string;
  source: "fallback" | "heuristic" | "llm";
};

export type InboxThreadItem = {
  bucketName: string;
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
  cacheHit: boolean;
  inbox: InboxHomepageData;
  timings: InboxLoadTimings;
};

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

function slugifyKeyPart(value: string, maxLength = 24) {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return (normalized || "empty").slice(0, maxLength);
}

function getBucketPrompt(bucket: BucketRecord) {
  return bucket.description?.trim() || `Use ${bucket.name} when it is the best fit.`;
}

function getLatestThreadFingerprint(threads: EmailThreadSummary[]) {
  const latestThread = threads.reduce<EmailThreadSummary | null>((latest, thread) => {
    const latestTimestamp = latest?.lastMessageAt
      ? new Date(latest.lastMessageAt).getTime()
      : 0;
    const currentTimestamp = thread.lastMessageAt
      ? new Date(thread.lastMessageAt).getTime()
      : 0;

    if (!latest || currentTimestamp >= latestTimestamp) {
      return thread;
    }

    return latest;
  }, null);

  return {
    threadId: latestThread?.id ?? "none",
    timestamp: latestThread?.lastMessageAt ?? "none",
  };
}

function buildInboxCacheKey(input: {
  buckets: BucketRecord[];
  defaultInboxThreadLimit: number;
  inboxThreadLimit: number;
  threads: EmailThreadSummary[];
}) {
  const latestThread = getLatestThreadFingerprint(input.threads);
  const bucketSegments = input.buckets.map((bucket) => {
    const prompt = getBucketPrompt(bucket);
    const promptHash = createHash("sha256").update(prompt).digest("hex").slice(0, 8);

    return [
      slugifyKeyPart(bucket.name, 18),
      `${slugifyKeyPart(prompt, 28)}-${promptHash}`,
    ].join("-");
  });

  return [
    `default-limit-${input.defaultInboxThreadLimit}`,
    `limit-${input.inboxThreadLimit}`,
    `latest-${slugifyKeyPart(latestThread.threadId, 18)}-${slugifyKeyPart(latestThread.timestamp, 30)}`,
    `buckets-${bucketSegments.join("__") || "none"}`,
  ].join("__");
}

function getInboxCacheKeyHash(cacheKey: string) {
  return createHash("sha256").update(cacheKey).digest("hex");
}

function parseCachedInboxHomepageData(value: unknown): InboxHomepageData | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InboxHomepageData>;

  if (
    typeof candidate.bucketCount !== "number" ||
    typeof candidate.configuredThreadLimit !== "number" ||
    typeof candidate.totalThreads !== "number" ||
    !Array.isArray(candidate.buckets)
  ) {
    return null;
  }

  return candidate as InboxHomepageData;
}

function getBucketSortKey(name: string) {
  const defaultIndex = DEFAULT_BUCKET_ORDER.indexOf(name);

  return defaultIndex === -1 ? Number.MAX_SAFE_INTEGER : defaultIndex;
}

function sortBuckets(buckets: BucketRecord[]) {
  return [...buckets].sort((left, right) => {
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

  if (
    activeBucketNames.has("Newsletter") &&
    (signals.marketingSignals ||
      (signals.automatedSender && /list-|mailchimp|substack/i.test(thread.sender ?? "")))
  ) {
    return {
      bucketName: "Newsletter",
      confidence: 0.97,
      rationale: "Recurring promotional or editorial subscription signals were detected.",
      source: "heuristic",
    };
  }

  if (activeBucketNames.has("Finance") && signals.financeSignals) {
    return {
      bucketName: "Finance",
      confidence: 0.94,
      rationale: "The subject or preview contains strong money-related signals.",
      source: "heuristic",
    };
  }

  if (
    activeBucketNames.has("Auto-archive") &&
    (thread.labelIds.includes("SPAM") ||
      thread.labelIds.includes("TRASH") ||
      AUTO_ARCHIVE_PATTERNS.some((pattern) => pattern.test(text)) ||
      (signals.automatedSender && thread.labelIds.includes("CATEGORY_UPDATES")))
  ) {
    return {
      bucketName: "Auto-archive",
      confidence: 0.91,
      rationale: "The thread looks like an automated update that usually does not need follow-up.",
      source: "heuristic",
    };
  }

  if (
    activeBucketNames.has("Important") &&
    signals.importantSignals &&
    !signals.marketingSignals
  ) {
    return {
      bucketName: "Important",
      confidence: 0.88,
      rationale: "The thread has urgency or priority signals that suggest prompt attention.",
      source: "heuristic",
    };
  }

  if (
    activeBucketNames.has("Personal") &&
    signals.freeMailSender &&
    !signals.automatedSender &&
    !signals.marketingSignals &&
    !signals.financeSignals
  ) {
    return {
      bucketName: "Personal",
      confidence: 0.82,
      rationale: "The sender looks like a direct personal contact instead of a bulk sender.",
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

async function classifyWithLLM(
  threads: EmailThreadSummary[],
  buckets: BucketRecord[],
): Promise<Map<string, FinalClassification>> {
  const results = new Map<string, FinalClassification>();

  if (!threads.length || !openAIClient || !model) {
    return results;
  }

  const chunkSize = getInboxClassificationBatchSize();
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
                    "You classify Gmail inbox threads into exactly one bucket.",
                    "Use only the provided bucket names.",
                    "If confidence is low, still choose the closest bucket and keep confidence low.",
                    "Follow each bucket prompt closely when deciding which single bucket fits best.",
                    'Return strict JSON with this shape: {"classifications":[{"threadId":"...","bucketName":"...","confidence":0.0,"rationale":"..."}]}',
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
        if (
          typeof entry.threadId !== "string" ||
          typeof entry.bucketName !== "string" ||
          !allowedBucketNames.has(entry.bucketName)
        ) {
          continue;
        }

        results.set(entry.threadId, {
          bucketName: entry.bucketName,
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
  const existingBucketMap = new Map(
    existingBuckets.map((bucket) => [bucket.name, bucket]),
  );
  const missingDefaults = DEFAULT_BUCKETS.filter(
    (bucket) => !existingBucketMap.has(bucket.name),
  );

  if (missingDefaults.length) {
    await prisma.bucket.createMany({
      data: missingDefaults.map((bucket) => ({
        description: bucket.description,
        kind: BucketKind.SYSTEM,
        name: bucket.name,
        ownerId,
        sortOrder: 1_000 + getBucketSortKey(bucket.name),
      })),
      skipDuplicates: true,
    });
  }

  const defaultPromptBackfills = DEFAULT_BUCKETS.flatMap((bucket) => {
    const existingBucket = existingBucketMap.get(bucket.name);

    if (!existingBucket || existingBucket.description?.trim()) {
      return [];
    }

    return prisma.bucket.update({
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
    });
  });

  if (defaultPromptBackfills.length) {
    await Promise.all(defaultPromptBackfills);
  }

  const allBuckets = await prisma.bucket.findMany({
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

  return sortBuckets(await normalizeBucketSortOrders(ownerId, allBuckets));
}

function normalizePreview(thread: EmailThreadSummary) {
  return (
    thread.snippet.trim() ||
    thread.body.split("\n").join(" ").slice(0, 220).trim()
  );
}

function buildHomepageData(
  buckets: BucketRecord[],
  threads: EmailThreadSummary[],
  classifications: Map<string, FinalClassification>,
): Omit<InboxHomepageData, "configuredThreadLimit"> {
  const groupedThreads = new Map<string, InboxThreadItem[]>();

  for (const bucket of buckets) {
    groupedThreads.set(bucket.name, []);
  }

  for (const thread of threads) {
    const classification = classifications.get(thread.id);

    if (!classification) {
      continue;
    }

    groupedThreads.get(classification.bucketName)?.push({
      bucketName: classification.bucketName,
      lastMessageAt: thread.lastMessageAt,
      preview: normalizePreview(thread),
      sender: thread.sender,
      source: classification.source,
      subject: thread.subject,
      threadId: thread.id,
    });
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
    totalThreads: threads.length,
  };
}

function getFallbackBucketName(buckets: BucketRecord[]) {
  return (
    buckets.find((bucket) => bucket.name === "Can wait")?.name ??
    buckets[0]?.name ??
    "Can wait"
  );
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

export async function loadInboxHomepage(input: {
  accessToken: string;
  ownerEmail: string;
  ownerImage?: string | null;
  ownerName?: string | null;
}): Promise<InboxLoadResult> {
  const owner = await upsertAppUser({
    email: input.ownerEmail,
    image: input.ownerImage,
    name: input.ownerName,
  });
  const buckets = await ensureOwnerBuckets(owner.id);
  const defaultInboxThreadLimit = getDefaultInboxThreadLimit();
  const inboxThreadLimit = await getWorkspaceInboxThreadLimit(input.ownerEmail);
  const gmailFetchStartedAt = performance.now();
  const threads = await listRecentInboxThreads(input.accessToken, {
    maxResults: inboxThreadLimit,
  });
  const gmailFetchMs = Math.round(performance.now() - gmailFetchStartedAt);
  const sortingStartedAt = performance.now();
  const cacheKey = buildInboxCacheKey({
    buckets,
    defaultInboxThreadLimit,
    inboxThreadLimit,
    threads,
  });
  const cacheKeyHash = getInboxCacheKeyHash(cacheKey);
  const cachedResult = await prisma.inboxClassificationCache.findUnique({
    where: {
      ownerId_cacheKeyHash: {
        cacheKeyHash,
        ownerId: owner.id,
      },
    },
    select: {
      cacheKey: true,
      payload: true,
    },
  });

  if (cachedResult?.cacheKey === cacheKey) {
    const parsedPayload = parseCachedInboxHomepageData(cachedResult.payload);

    if (parsedPayload) {
      return {
        cacheHit: true,
        inbox: parsedPayload,
        timings: {
          gmailFetchMs,
          sortingMs: Math.round(performance.now() - sortingStartedAt),
        },
      };
    }
  }

  const activeBucketNames = new Set(buckets.map((bucket) => bucket.name));
  const classifications = new Map<string, FinalClassification>();
  const threadsNeedingLLM: EmailThreadSummary[] = [];

  for (const thread of threads) {
    const heuristicClassification = classifyWithHeuristics(
      thread,
      detectSignals(thread),
      activeBucketNames,
    );

    if (heuristicClassification) {
      classifications.set(thread.id, heuristicClassification);
      continue;
    }

    threadsNeedingLLM.push(thread);
  }

  const llmClassifications = await classifyWithLLM(threadsNeedingLLM, buckets);
  const fallbackBucketName = getFallbackBucketName(buckets);

  for (const thread of threadsNeedingLLM) {
    const llmClassification = llmClassifications.get(thread.id);

    if (llmClassification && llmClassification.confidence >= 0.45) {
      classifications.set(thread.id, llmClassification);
      continue;
    }

    classifications.set(thread.id, {
      bucketName: fallbackBucketName,
      confidence: llmClassification?.confidence ?? 0.3,
      rationale:
        llmClassification?.rationale ??
        "No strong signal was found, so the thread was placed in the default low-priority bucket.",
      source: "fallback",
    });
  }

  const payload = {
    ...buildHomepageData(buckets, threads, classifications),
    configuredThreadLimit: inboxThreadLimit,
  } satisfies InboxHomepageData;

  await prisma.inboxClassificationCache.upsert({
    where: {
      ownerId_cacheKeyHash: {
        cacheKeyHash,
        ownerId: owner.id,
      },
    },
    create: {
      cacheKey,
      cacheKeyHash,
      ownerId: owner.id,
      payload: payload as Prisma.InputJsonValue,
    },
    update: {
      cacheKey,
      payload: payload as Prisma.InputJsonValue,
    },
  });

  return {
    cacheHit: false,
    inbox: payload,
    timings: {
      gmailFetchMs,
      sortingMs: Math.round(performance.now() - sortingStartedAt),
    },
  };
}
