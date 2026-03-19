export type InboxStatePayloadShape<TThread = unknown, TMembership = unknown> = {
  bucketMembershipsByThreadId: Record<string, Record<string, TMembership>>;
  configuredThreadLimit: number;
  threadIds: string[];
  threadsById: Record<string, TThread>;
  version: 2;
};

export type InboxStateRow<TThread = unknown, TMembership = unknown> = {
  cacheKey: string;
  payload: InboxStatePayloadShape<TThread, TMembership>;
  updatedAt: Date;
};

export type LoadedInboxStatePayload<TThread = unknown, TMembership = unknown> = {
  isPartial: boolean;
  payload: InboxStatePayloadShape<TThread, TMembership>;
  requiresSave: boolean;
};

export function createLimitedInboxStatePayload<TThread, TMembership>(
  payload: InboxStatePayloadShape<TThread, TMembership>,
  configuredThreadLimit: number,
): InboxStatePayloadShape<TThread, TMembership> {
  const limitedPayload: InboxStatePayloadShape<TThread, TMembership> = {
    bucketMembershipsByThreadId: {},
    configuredThreadLimit,
    threadIds: [],
    threadsById: {},
    version: 2,
  };
  const limitedThreadIds = payload.threadIds.slice(0, configuredThreadLimit);

  for (const threadId of limitedThreadIds) {
    const snapshot = payload.threadsById[threadId];

    if (!snapshot) {
      continue;
    }

    limitedPayload.threadIds.push(threadId);
    limitedPayload.threadsById[threadId] = snapshot;
    limitedPayload.bucketMembershipsByThreadId[threadId] = {
      ...(payload.bucketMembershipsByThreadId[threadId] ?? {}),
    };
  }

  return limitedPayload;
}

export function selectCachedInboxStatePayload<TThread, TMembership>(input: {
  configuredThreadLimit: number;
  expectedCacheKey: string;
  rows: InboxStateRow<TThread, TMembership>[];
}): LoadedInboxStatePayload<TThread, TMembership> | null {
  const compatibleRows = input.rows
    .filter(
      (row) => row.payload.configuredThreadLimit >= input.configuredThreadLimit,
    )
    .sort((left, right) => {
      const updatedAtDelta = right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return left.payload.configuredThreadLimit - right.payload.configuredThreadLimit;
    });
  const compatibleRow = compatibleRows[0];

  if (compatibleRow) {
    if (compatibleRow.payload.configuredThreadLimit === input.configuredThreadLimit) {
      return {
        isPartial: false,
        payload: compatibleRow.payload,
        requiresSave: compatibleRow.cacheKey !== input.expectedCacheKey,
      };
    }

    return {
      isPartial: false,
      payload: createLimitedInboxStatePayload(
        compatibleRow.payload,
        input.configuredThreadLimit,
      ),
      requiresSave: true,
    };
  }

  const partialRows = input.rows
    .filter(
      (row) => row.payload.configuredThreadLimit < input.configuredThreadLimit,
    )
    .sort((left, right) => {
      const updatedAtDelta = right.updatedAt.getTime() - left.updatedAt.getTime();

      if (updatedAtDelta !== 0) {
        return updatedAtDelta;
      }

      return right.payload.configuredThreadLimit - left.payload.configuredThreadLimit;
    });
  const partialRow = partialRows[0];

  if (!partialRow) {
    return null;
  }

  return {
    isPartial: true,
    payload: partialRow.payload,
    requiresSave: true,
  };
}

export const selectCompatibleInboxStatePayload = selectCachedInboxStatePayload;
