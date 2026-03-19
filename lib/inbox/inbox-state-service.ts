import { createHash } from "node:crypto";

import { BucketKind, type Prisma } from "@/generated/prisma/client";
import {
  ensureOwnerBuckets,
  getBucketPrompt,
  sortBucketNames,
} from "@/lib/inbox/bucket-service";
import {
  type LoadedInboxStatePayload as LoadedLegacyInboxStatePayload,
  selectCachedInboxStatePayload,
} from "@/lib/inbox/cache-helpers";
import {
  classifyThreadsAgainstBucket,
  classifyThreadsAgainstBuckets,
} from "@/lib/inbox/inbox-classifier";
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

const LEGACY_INBOX_STATE_CACHE_KEY_PREFIX = "inbox-state-v2";
const INBOX_CACHE_KEY_PREFIX = "inbox-state-v3";
const INBOX_MANIFEST_CACHE_KEY = `${INBOX_CACHE_KEY_PREFIX}:manifest`;
const INBOX_THREAD_CACHE_KEY_PREFIX = `${INBOX_CACHE_KEY_PREFIX}:thread:`;
const INBOX_BUCKET_MEMBERSHIP_CACHE_KEY_PREFIX =
  `${INBOX_CACHE_KEY_PREFIX}:membership:`;

type LegacyInboxStatePayload = {
  bucketMembershipsByThreadId: Record<string, Record<string, CachedBucketMembership>>;
  configuredThreadLimit: number;
  threadIds: string[];
  threadsById: Record<string, CachedThreadSnapshot>;
  version: 2;
};

type InboxHeadManifestPayload = {
  threadIds: string[];
  version: 3;
};

type InboxThreadCachePayload = {
  snapshot: CachedThreadSnapshot;
  version: 3;
};

type InboxBucketMembershipCachePayload = {
  bucketId: string;
  membership: CachedBucketMembership;
  threadId: string;
  version: 3;
};

type LoadedInboxCacheState = {
  manifestThreadIds: string[];
  payload: InboxStatePayload | null;
  requiresSave: boolean;
};

const CACHE_WRITE_BATCH_SIZE = 50;

function parseLegacyInboxStatePayload(value: unknown): LegacyInboxStatePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<LegacyInboxStatePayload>;

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

  return candidate as LegacyInboxStatePayload;
}

function parseInboxHeadManifestPayload(value: unknown): InboxHeadManifestPayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InboxHeadManifestPayload>;

  if (candidate.version !== 3 || !Array.isArray(candidate.threadIds)) {
    return null;
  }

  return {
    threadIds: candidate.threadIds.filter(
      (threadId): threadId is string => typeof threadId === "string",
    ),
    version: 3,
  };
}

function parseInboxThreadCachePayload(value: unknown): InboxThreadCachePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InboxThreadCachePayload>;

  if (
    candidate.version !== 3 ||
    !candidate.snapshot ||
    typeof candidate.snapshot !== "object" ||
    typeof candidate.snapshot.threadId !== "string"
  ) {
    return null;
  }

  return candidate as InboxThreadCachePayload;
}

function parseInboxBucketMembershipCachePayload(
  value: unknown,
): InboxBucketMembershipCachePayload | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const candidate = value as Partial<InboxBucketMembershipCachePayload>;

  if (
    candidate.version !== 3 ||
    typeof candidate.bucketId !== "string" ||
    typeof candidate.threadId !== "string" ||
    !candidate.membership ||
    typeof candidate.membership !== "object"
  ) {
    return null;
  }

  return candidate as InboxBucketMembershipCachePayload;
}

function createEmptyInboxStatePayload(configuredThreadLimit: number): InboxStatePayload {
  return {
    bucketMembershipsByThreadId: {},
    configuredThreadLimit,
    threadIds: [],
    threadsById: {},
    version: 3,
  };
}

function getBucketPromptHash(bucket: BucketRecord) {
  return createHash("sha256").update(getBucketPrompt(bucket)).digest("hex");
}

function getBucketPromptHashes(buckets: BucketRecord[]) {
  return new Map(buckets.map((bucket) => [bucket.id, getBucketPromptHash(bucket)]));
}

function getInboxStateCacheKeyHash(cacheKey: string) {
  return createHash("sha256").update(cacheKey).digest("hex");
}

function getInboxThreadCacheKey(threadId: string) {
  return `${INBOX_THREAD_CACHE_KEY_PREFIX}${threadId}`;
}

function getInboxBucketMembershipCacheKey(threadId: string, bucketId: string) {
  return `${INBOX_BUCKET_MEMBERSHIP_CACHE_KEY_PREFIX}${threadId}:${bucketId}`;
}

function buildInboxStatePayload(input: {
  configuredThreadLimit: number;
  membershipsByThreadId: Record<string, Record<string, CachedBucketMembership>>;
  orderedThreadIds: string[];
  snapshotsById: Record<string, CachedThreadSnapshot>;
}) {
  const payload = createEmptyInboxStatePayload(input.configuredThreadLimit);

  for (const threadId of input.orderedThreadIds.slice(0, input.configuredThreadLimit)) {
    const snapshot = input.snapshotsById[threadId];

    if (!snapshot) {
      continue;
    }

    payload.threadIds.push(threadId);
    payload.threadsById[threadId] = snapshot;
    payload.bucketMembershipsByThreadId[threadId] = {
      ...(input.membershipsByThreadId[threadId] ?? {}),
    };
  }

  return payload;
}

async function loadInboxHeadManifest(ownerId: string) {
  const row = await prisma.inboxClassificationCache.findUnique({
    where: {
      ownerId_cacheKeyHash: {
        cacheKeyHash: getInboxStateCacheKeyHash(INBOX_MANIFEST_CACHE_KEY),
        ownerId,
      },
    },
    select: {
      payload: true,
    },
  });

  return parseInboxHeadManifestPayload(row?.payload)?.threadIds ?? [];
}

async function loadCachedThreadSnapshots(ownerId: string, threadIds: string[]) {
  if (!threadIds.length) {
    return {};
  }

  const rows = await prisma.inboxClassificationCache.findMany({
    where: {
      cacheKeyHash: {
        in: threadIds.map((threadId) =>
          getInboxStateCacheKeyHash(getInboxThreadCacheKey(threadId)),
        ),
      },
      ownerId,
    },
    select: {
      payload: true,
    },
  });

  const snapshotsById: Record<string, CachedThreadSnapshot> = {};

  for (const row of rows) {
    const payload = parseInboxThreadCachePayload(row.payload);

    if (!payload) {
      continue;
    }

    snapshotsById[payload.snapshot.threadId] = payload.snapshot;
  }

  return snapshotsById;
}

async function loadCachedBucketMemberships(input: {
  bucketIds: string[];
  ownerId: string;
  threadIds: string[];
}) {
  if (!input.threadIds.length || !input.bucketIds.length) {
    return {};
  }

  const rows = await prisma.inboxClassificationCache.findMany({
    where: {
      cacheKeyHash: {
        in: input.threadIds.flatMap((threadId) =>
          input.bucketIds.map((bucketId) =>
            getInboxStateCacheKeyHash(
              getInboxBucketMembershipCacheKey(threadId, bucketId),
            ),
          ),
        ),
      },
      ownerId: input.ownerId,
    },
    select: {
      payload: true,
    },
  });

  const membershipsByThreadId: Record<
    string,
    Record<string, CachedBucketMembership>
  > = {};

  for (const row of rows) {
    const payload = parseInboxBucketMembershipCachePayload(row.payload);

    if (!payload) {
      continue;
    }

    if (!membershipsByThreadId[payload.threadId]) {
      membershipsByThreadId[payload.threadId] = {};
    }

    membershipsByThreadId[payload.threadId][payload.bucketId] =
      payload.membership;
  }

  return membershipsByThreadId;
}

async function loadLegacyInboxStatePayload(
  ownerId: string,
  configuredThreadLimit: number,
) {
  const rows = await prisma.inboxClassificationCache.findMany({
    where: {
      cacheKey: {
        startsWith: LEGACY_INBOX_STATE_CACHE_KEY_PREFIX,
      },
      ownerId,
    },
    select: {
      cacheKey: true,
      payload: true,
      updatedAt: true,
    },
  });
  const parsedRows = rows.flatMap((row) => {
    const payload = parseLegacyInboxStatePayload(row.payload);

    if (!payload) {
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
  const cachedState = selectCachedInboxStatePayload({
    configuredThreadLimit,
    expectedCacheKey: `${LEGACY_INBOX_STATE_CACHE_KEY_PREFIX}:${configuredThreadLimit}`,
    rows: parsedRows,
  }) as LoadedLegacyInboxStatePayload<
    CachedThreadSnapshot,
    CachedBucketMembership
  > | null;

  if (!cachedState) {
    return null;
  }

  return {
    manifestThreadIds: cachedState.payload.threadIds,
    payload: buildInboxStatePayload({
      configuredThreadLimit,
      membershipsByThreadId: cachedState.payload.bucketMembershipsByThreadId,
      orderedThreadIds: cachedState.payload.threadIds,
      snapshotsById: cachedState.payload.threadsById,
    }),
    requiresSave: true,
  } satisfies LoadedInboxCacheState;
}

async function loadInboxStatePayload(input: {
  buckets: BucketRecord[];
  configuredThreadLimit: number;
  ownerId: string;
}): Promise<LoadedInboxCacheState | null> {
  const manifestThreadIds = (await loadInboxHeadManifest(input.ownerId)).slice(
    0,
    input.configuredThreadLimit,
  );

  if (manifestThreadIds.length) {
    const [snapshotsById, membershipsByThreadId] = await Promise.all([
      loadCachedThreadSnapshots(input.ownerId, manifestThreadIds),
      loadCachedBucketMemberships({
        bucketIds: input.buckets.map((bucket) => bucket.id),
        ownerId: input.ownerId,
        threadIds: manifestThreadIds,
      }),
    ]);

    return {
      manifestThreadIds,
      payload: buildInboxStatePayload({
        configuredThreadLimit: input.configuredThreadLimit,
        membershipsByThreadId,
        orderedThreadIds: manifestThreadIds,
        snapshotsById,
      }),
      requiresSave: false,
    };
  }

  return loadLegacyInboxStatePayload(
    input.ownerId,
    input.configuredThreadLimit,
  );
}

async function saveInboxStatePayload(input: {
  buckets: BucketRecord[];
  ownerId: string;
  payload: InboxStatePayload;
}) {
  const keepCacheKeyHashes = new Set<string>([
    getInboxStateCacheKeyHash(INBOX_MANIFEST_CACHE_KEY),
  ]);
  const writes: Prisma.PrismaPromise<unknown>[] = [];

  for (const threadId of input.payload.threadIds) {
    const snapshot = input.payload.threadsById[threadId];

    if (!snapshot) {
      continue;
    }

    const threadCacheKey = getInboxThreadCacheKey(threadId);

    keepCacheKeyHashes.add(getInboxStateCacheKeyHash(threadCacheKey));
    writes.push(
      prisma.inboxClassificationCache.upsert({
        where: {
          ownerId_cacheKeyHash: {
            cacheKeyHash: getInboxStateCacheKeyHash(threadCacheKey),
            ownerId: input.ownerId,
          },
        },
        create: {
          cacheKey: threadCacheKey,
          cacheKeyHash: getInboxStateCacheKeyHash(threadCacheKey),
          ownerId: input.ownerId,
          payload: {
            snapshot,
            version: 3,
          } satisfies InboxThreadCachePayload as Prisma.InputJsonValue,
        },
        update: {
          cacheKey: threadCacheKey,
          payload: {
            snapshot,
            version: 3,
          } satisfies InboxThreadCachePayload as Prisma.InputJsonValue,
        },
      }),
    );

    for (const bucket of input.buckets) {
      const membership =
        input.payload.bucketMembershipsByThreadId[threadId]?.[bucket.id];

      if (!membership) {
        continue;
      }

      const membershipCacheKey = getInboxBucketMembershipCacheKey(
        threadId,
        bucket.id,
      );

      keepCacheKeyHashes.add(getInboxStateCacheKeyHash(membershipCacheKey));
      writes.push(
        prisma.inboxClassificationCache.upsert({
          where: {
            ownerId_cacheKeyHash: {
              cacheKeyHash: getInboxStateCacheKeyHash(membershipCacheKey),
              ownerId: input.ownerId,
            },
          },
          create: {
            cacheKey: membershipCacheKey,
            cacheKeyHash: getInboxStateCacheKeyHash(membershipCacheKey),
            ownerId: input.ownerId,
            payload: {
              bucketId: bucket.id,
              membership,
              threadId,
              version: 3,
            } satisfies InboxBucketMembershipCachePayload as Prisma.InputJsonValue,
          },
          update: {
            cacheKey: membershipCacheKey,
            payload: {
              bucketId: bucket.id,
              membership,
              threadId,
              version: 3,
            } satisfies InboxBucketMembershipCachePayload as Prisma.InputJsonValue,
          },
        }),
      );
    }
  }

  await prisma.inboxClassificationCache.upsert({
    where: {
      ownerId_cacheKeyHash: {
        cacheKeyHash: getInboxStateCacheKeyHash(INBOX_MANIFEST_CACHE_KEY),
        ownerId: input.ownerId,
      },
    },
    create: {
      cacheKey: INBOX_MANIFEST_CACHE_KEY,
      cacheKeyHash: getInboxStateCacheKeyHash(INBOX_MANIFEST_CACHE_KEY),
      ownerId: input.ownerId,
      payload: {
        threadIds: input.payload.threadIds,
        version: 3,
      } satisfies InboxHeadManifestPayload as Prisma.InputJsonValue,
    },
    update: {
      cacheKey: INBOX_MANIFEST_CACHE_KEY,
      payload: {
        threadIds: input.payload.threadIds,
        version: 3,
      } satisfies InboxHeadManifestPayload as Prisma.InputJsonValue,
    },
  });

  for (let startIndex = 0; startIndex < writes.length; startIndex += CACHE_WRITE_BATCH_SIZE) {
    await Promise.all(
      writes.slice(startIndex, startIndex + CACHE_WRITE_BATCH_SIZE),
    );
  }

  await prisma.inboxClassificationCache.deleteMany({
    where: {
      ownerId: input.ownerId,
      cacheKey: {
        startsWith: LEGACY_INBOX_STATE_CACHE_KEY_PREFIX,
      },
    },
  });

  await prisma.inboxClassificationCache.deleteMany({
    where: {
      ownerId: input.ownerId,
      AND: [
        {
          OR: [
            {
              cacheKey: {
                equals: INBOX_MANIFEST_CACHE_KEY,
              },
            },
            {
              cacheKey: {
                startsWith: INBOX_THREAD_CACHE_KEY_PREFIX,
              },
            },
            {
              cacheKey: {
                startsWith: INBOX_BUCKET_MEMBERSHIP_CACHE_KEY_PREFIX,
              },
            },
          ],
        },
        {
          cacheKeyHash: {
            notIn: [...keepCacheKeyHashes],
          },
        },
      ],
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
        body: snapshot.body,
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

function getThreadIdsToFetchFromGmail(input: {
  cachedManifestThreadIds: string[];
  cachedSnapshotsById: Record<string, CachedThreadSnapshot>;
  changeSummary: InboxSyncChangeSummary;
  currentThreadIds: string[];
}) {
  const missingThreadIds = input.currentThreadIds.filter(
    (threadId) => !input.cachedSnapshotsById[threadId],
  );

  if (input.changeSummary.kind === "mixed") {
    return input.currentThreadIds;
  }

  if (input.changeSummary.kind === "none") {
    return missingThreadIds;
  }

  const cachedManifestThreadIdSet = new Set(input.cachedManifestThreadIds);
  const addedThreadIds = input.currentThreadIds.filter(
    (threadId) => !cachedManifestThreadIdSet.has(threadId),
  );

  return Array.from(new Set([...addedThreadIds, ...missingThreadIds]));
}

async function synchronizeInboxStateFromGmail(input: {
  accessToken: string;
  buckets: BucketRecord[];
  cachedManifestThreadIds: string[];
  inboxThreadLimit: number;
  ownerId: string;
}) {
  const threadIds = await listRecentInboxThreadIds(input.accessToken, {
    maxResults: input.inboxThreadLimit,
  });
  const [cachedSnapshotsById, cachedMembershipsByThreadId] = await Promise.all([
    loadCachedThreadSnapshots(input.ownerId, threadIds),
    loadCachedBucketMemberships({
      bucketIds: input.buckets.map((bucket) => bucket.id),
      ownerId: input.ownerId,
      threadIds,
    }),
  ]);
  const changeSummary = summarizeInboxSyncChanges({
    cachedThreadIds: input.cachedManifestThreadIds,
    currentThreadIds: threadIds,
  });
  const threadIdsToFetch = getThreadIdsToFetchFromGmail({
    cachedManifestThreadIds: input.cachedManifestThreadIds,
    cachedSnapshotsById,
    changeSummary,
    currentThreadIds: threadIds,
  });
  const fetchedThreads = threadIdsToFetch.length
    ? await getEmailThreads(input.accessToken, threadIdsToFetch)
    : [];
  const fetchedThreadsById = new Map(
    fetchedThreads.map((thread) => [thread.id, thread] as const),
  );
  const payload = createEmptyInboxStatePayload(input.inboxThreadLimit);
  const threadsNeedingFullClassification: EmailThreadSummary[] = [];

  for (const threadId of threadIds) {
    const fetchedThread = fetchedThreadsById.get(threadId);
    const snapshot = fetchedThread
      ? summarizeThreadForPreview(fetchedThread)
      : cachedSnapshotsById[threadId];

    if (!snapshot) {
      continue;
    }

    const existingSnapshot = cachedSnapshotsById[threadId];
    const existingMemberships =
      !fetchedThread || existingSnapshot?.fingerprint === snapshot.fingerprint
        ? cachedMembershipsByThreadId[threadId] ?? {}
        : {};

    payload.threadIds.push(threadId);
    payload.threadsById[threadId] = snapshot;
    payload.bucketMembershipsByThreadId[threadId] = { ...existingMemberships };

    if (
      fetchedThread &&
      (!existingSnapshot || existingSnapshot.fingerprint !== snapshot.fingerprint)
    ) {
      threadsNeedingFullClassification.push(fetchedThread);
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
      cacheKey: {
        startsWith: "inbox-state-v",
      },
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
  const manifestThreadIds = (await loadInboxHeadManifest(owner.id)).slice(
    0,
    inboxThreadLimit,
  );
  const fallbackLegacyState =
    manifestThreadIds.length === 0
      ? await loadLegacyInboxStatePayload(owner.id, inboxThreadLimit)
      : null;
  const cachedThreadIds =
    manifestThreadIds.length > 0
      ? manifestThreadIds
      : fallbackLegacyState?.manifestThreadIds ?? [];

  if (!cachedThreadIds.length) {
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
    cachedThreadIds,
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
  const cachedState = await loadInboxStatePayload({
    buckets,
    configuredThreadLimit: inboxThreadLimit,
    ownerId: owner.id,
  });
  const cachedPayload = cachedState?.payload ?? null;

  if (cachedPayload?.threadIds.length && !input.refresh) {
    const hadMembershipUpdates = await ensureBucketMembershipsAreCurrent(
      cachedPayload,
      buckets,
    );

    if (hadMembershipUpdates || cachedState?.requiresSave) {
      await saveInboxStatePayload({
        buckets,
        ownerId: owner.id,
        payload: cachedPayload,
      });
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
    cachedManifestThreadIds: cachedState?.manifestThreadIds ?? [],
    inboxThreadLimit,
    ownerId: owner.id,
  });
  const gmailFetchMs = Math.round(performance.now() - gmailFetchStartedAt);

  await saveInboxStatePayload({
    buckets,
    ownerId: owner.id,
    payload: synchronized.payload,
  });

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
