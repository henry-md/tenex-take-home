import { BucketKind, type Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { upsertAppUser } from "@/lib/users";

import {
  BucketRecord,
  BucketSetting,
  DEFAULT_BUCKET_NAMES,
  DEFAULT_BUCKET_ORDER,
  DEFAULT_BUCKETS,
} from "@/lib/inbox/inbox-types";

export function getBucketPrompt(bucket: BucketRecord) {
  return bucket.description?.trim() || `Use ${bucket.name} when it is the best fit.`;
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

export function sortBucketNames(
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

export async function ensureOwnerBuckets(ownerId: string) {
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

function toBucketSettings(buckets: BucketRecord[]) {
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

  return toBucketSettings(buckets);
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

  return toBucketSettings(await restoreDefaultBuckets(owner.id));
}
