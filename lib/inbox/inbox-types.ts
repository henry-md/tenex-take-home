import { type BucketKind } from "@/generated/prisma/client";
import { type InboxSyncChangeSummary } from "@/lib/inbox/sync-change-summary";

export const DEFAULT_BUCKETS = [
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

export const DEFAULT_BUCKET_NAMES = new Set<string>(
  DEFAULT_BUCKETS.map((bucket) => bucket.name),
);
export const DEFAULT_BUCKET_ORDER = DEFAULT_BUCKETS.map(
  (bucket) => bucket.name,
) as string[];

export type BucketRecord = {
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

export type ThreadSignals = {
  automatedSender: boolean;
  financeSignals: boolean;
  freeMailSender: boolean;
  importantSignals: boolean;
  marketingSignals: boolean;
  senderDomain: string | null;
};

export type FinalClassification = {
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
  changeSummary: InboxSyncChangeSummary;
  emailCacheHit: boolean;
  inbox: InboxHomepageData;
  sortingCacheHit: boolean;
  timings: InboxLoadTimings;
};

export type InboxRefreshStatus = {
  changedThreadCount: number;
  checkedAt: string;
  hasUpdates: boolean;
};

export type CachedThreadSnapshot = {
  body: string;
  fingerprint: string;
  labelIds: string[];
  lastMessageAt: string | null;
  preview: string;
  sender: string | null;
  subject: string;
  threadId: string;
};

export type CachedBucketMembership = {
  applies: boolean;
  bucketPromptHash: string;
  confidence: number;
  rationale: string;
  source: FinalClassification["source"];
  threadFingerprint: string;
};

export type InboxStatePayload = {
  bucketMembershipsByThreadId: Record<string, Record<string, CachedBucketMembership>>;
  configuredThreadLimit: number;
  threadIds: string[];
  threadsById: Record<string, CachedThreadSnapshot>;
  version: 2;
};

export type BucketMembershipClassification = {
  applies: boolean;
  confidence: number;
  rationale: string;
  source: FinalClassification["source"];
};
