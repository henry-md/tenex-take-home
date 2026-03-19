import { createHash } from "node:crypto";

import { BucketKind, type Prisma } from "@/generated/prisma/client";
import {
  ensureOwnerBuckets,
  getBucketPrompt,
  sortBucketNames,
} from "@/lib/inbox/bucket-service";
import {
  classifyThreadsAgainstBucket,
  classifyThreadsAgainstBuckets,
} from "@/lib/inbox/inbox-classifier";
import {
  type LoadedInboxStatePayload,
  selectCompatibleInboxStatePayload,
} from "@/lib/inbox/cache-helpers";
import {
  BucketRecord,
  CachedBucketMembership,
  CachedThreadSnapshot,
  FinalClassification,
  InboxBucketGroup,
  InboxHomepageData,
  InboxLoadResult,
  InboxRefreshStatus,
  InboxStatePayload,
  InboxThreadItem,
} from "@/lib/inbox/inbox-types";
import {
  type InboxSyncChangeSummary,
  summarizeInboxSyncChanges,
} from "@/lib/inbox/sync-change-summary";
import {
  getEmailThreads,
  listRecentInboxThreadIds,
  type EmailThreadSummary,
} from "@/lib/google-workspace/gmail";
import { getWorkspaceInboxThreadLimit } from "@/lib/google-workspace/inbox-thread-limit";
import { prisma } from "@/lib/prisma";
import { upsertAppUser } from "@/lib/users";

const INBOX_STATE_CACHE_KEY_PREFIX = "inbox-state-v2";

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
  const compatibleRows = rows.flatMap((row) => {
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

function normalizePreview(thread: EmailThreadSummary) {
  return (
    thread.snippet.trim() ||
    thread.body.split("\n").join(" ").slice(0, 220).trim()
  );
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
    const bucketThreads = (groupedThreads.get(bucket.name) ?? []).sort(
      (left, right) => {
        const leftTimestamp = left.lastMessageAt
          ? new Date(left.lastMessageAt).getTime()
          : 0;
        const rightTimestamp = right.lastMessageAt
          ? new Date(right.lastMessageAt).getTime()
          : 0;

        return rightTimestamp - leftTimestamp;
      },
    );

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
    const resolvedMemberships = await classifyThreadsAgainstBucket(
      staleThreads,
      bucket,
      buckets,
    );

    for (const thread of staleThreads) {
      const snapshot = payload.threadsById[thread.id];
      const membership = resolvedMemberships.get(thread.id) ?? {
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
  const currentThreadTimestamps = new Map(
    threads.map((thread) => [thread.id, thread.lastMessageAt] as const),
  );
  const cachedThreadTimestamps = new Map(
    Object.values(input.existingPayload?.threadsById ?? {}).map((thread) => [
      thread.threadId,
      thread.lastMessageAt,
    ]),
  );
  const changeSummary = summarizeInboxSyncChanges({
    cachedThreadIds: input.existingPayload?.threadIds ?? [],
    cachedThreadTimestamps,
    currentThreadIds: threadIds,
    currentThreadTimestamps,
  });

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
    changeSummary,
    payload,
    reclassified:
      hadMembershipUpdates || threadsNeedingFullClassification.length > 0,
  };
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
      changedThreadCount: 0,
      checkedAt: new Date().toISOString(),
      hasUpdates: false,
    };
  }

  const latestThreadIds = await listRecentInboxThreadIds(input.accessToken, {
    maxResults: inboxThreadLimit,
  });
  const changeSummary = summarizeInboxSyncChanges({
    cachedThreadIds: parsedPayload.threadIds,
    currentThreadIds: latestThreadIds,
  });

  return {
    changedThreadCount: changeSummary.changedThreadCount,
    checkedAt: new Date().toISOString(),
    hasUpdates: changeSummary.changedThreadCount > 0,
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
      changeSummary: {
        addedThreadCount: 0,
        changedThreadCount: 0,
        kind: "none",
        removedThreadCount: 0,
      } satisfies InboxSyncChangeSummary,
      emailCacheHit: true,
      inbox: buildHomepageDataFromState(buckets, cachedPayload),
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
    changeSummary: synchronized.changeSummary,
    emailCacheHit: false,
    inbox: buildHomepageDataFromState(buckets, synchronized.payload),
    sortingCacheHit: !synchronized.reclassified,
    timings: {
      gmailFetchMs,
      sortingMs: Math.round(performance.now() - sortingStartedAt),
    },
  };
}
