export type InboxSyncChangeKind =
  | "deleted-threads"
  | "mixed"
  | "new-threads"
  | "none";

export type InboxSyncChangeSummary = {
  addedThreadCount: number;
  changedThreadCount: number;
  kind: InboxSyncChangeKind;
  removedThreadCount: number;
};

function parseTimestamp(value: string | null | undefined) {
  if (!value) {
    return null;
  }

  const parsedValue = Date.parse(value);

  return Number.isNaN(parsedValue) ? null : parsedValue;
}

function areThreadIdsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) {
    return false;
  }

  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }

  return true;
}

function countChangedPositions(left: string[], right: string[]) {
  const maxLength = Math.max(left.length, right.length);
  let changedPositionCount = 0;

  for (let index = 0; index < maxLength; index += 1) {
    if (left[index] !== right[index]) {
      changedPositionCount += 1;
    }
  }

  return changedPositionCount;
}

function inferKindFromThreadOrder(input: {
  cachedThreadIds: string[];
  currentThreadIds: string[];
}) {
  const cachedThreadIdSet = new Set(input.cachedThreadIds);
  const sharedCurrentThreadIds = input.currentThreadIds.filter((threadId) =>
    cachedThreadIdSet.has(threadId),
  );

  if (!sharedCurrentThreadIds.length) {
    return "mixed" satisfies InboxSyncChangeKind;
  }

  if (
    areThreadIdsEqual(
      sharedCurrentThreadIds,
      input.cachedThreadIds.slice(0, sharedCurrentThreadIds.length),
    )
  ) {
    return "new-threads" satisfies InboxSyncChangeKind;
  }

  if (
    areThreadIdsEqual(
      sharedCurrentThreadIds,
      input.cachedThreadIds.slice(-sharedCurrentThreadIds.length),
    )
  ) {
    return "deleted-threads" satisfies InboxSyncChangeKind;
  }

  return "mixed" satisfies InboxSyncChangeKind;
}

function inferKindFromTimestamps(input: {
  addedThreadIds: string[];
  currentThreadTimestamps?: ReadonlyMap<string, string | null>;
  removedThreadIds: string[];
  cachedThreadTimestamps?: ReadonlyMap<string, string | null>;
}) {
  if (!input.currentThreadTimestamps || !input.cachedThreadTimestamps) {
    return null;
  }

  const addedThreadTimes = input.addedThreadIds
    .map((threadId) => parseTimestamp(input.currentThreadTimestamps?.get(threadId)))
    .filter((value): value is number => value !== null);
  const removedThreadTimes = input.removedThreadIds
    .map((threadId) => parseTimestamp(input.cachedThreadTimestamps?.get(threadId)))
    .filter((value): value is number => value !== null);

  if (
    addedThreadTimes.length !== input.addedThreadIds.length ||
    removedThreadTimes.length !== input.removedThreadIds.length
  ) {
    return null;
  }

  const newestAddedThreadTime = Math.max(...addedThreadTimes);
  const oldestAddedThreadTime = Math.min(...addedThreadTimes);
  const newestRemovedThreadTime = Math.max(...removedThreadTimes);
  const oldestRemovedThreadTime = Math.min(...removedThreadTimes);

  if (oldestAddedThreadTime > newestRemovedThreadTime) {
    return "new-threads" satisfies InboxSyncChangeKind;
  }

  if (newestAddedThreadTime < oldestRemovedThreadTime) {
    return "deleted-threads" satisfies InboxSyncChangeKind;
  }

  return null;
}

export function summarizeInboxSyncChanges(input: {
  cachedThreadIds: string[];
  cachedThreadTimestamps?: ReadonlyMap<string, string | null>;
  currentThreadIds: string[];
  currentThreadTimestamps?: ReadonlyMap<string, string | null>;
}): InboxSyncChangeSummary {
  const cachedThreadIdSet = new Set(input.cachedThreadIds);
  const currentThreadIdSet = new Set(input.currentThreadIds);
  const addedThreadIds = input.currentThreadIds.filter(
    (threadId) => !cachedThreadIdSet.has(threadId),
  );
  const removedThreadIds = input.cachedThreadIds.filter(
    (threadId) => !currentThreadIdSet.has(threadId),
  );

  if (!addedThreadIds.length && !removedThreadIds.length) {
    if (areThreadIdsEqual(input.cachedThreadIds, input.currentThreadIds)) {
      return {
        addedThreadCount: 0,
        changedThreadCount: 0,
        kind: "none",
        removedThreadCount: 0,
      };
    }

    return {
      addedThreadCount: 0,
      changedThreadCount: countChangedPositions(
        input.cachedThreadIds,
        input.currentThreadIds,
      ),
      kind: "mixed",
      removedThreadCount: 0,
    };
  }

  if (!removedThreadIds.length) {
    return {
      addedThreadCount: addedThreadIds.length,
      changedThreadCount: addedThreadIds.length,
      kind: "new-threads",
      removedThreadCount: 0,
    };
  }

  if (!addedThreadIds.length) {
    return {
      addedThreadCount: 0,
      changedThreadCount: removedThreadIds.length,
      kind: "deleted-threads",
      removedThreadCount: removedThreadIds.length,
    };
  }

  const kind =
    inferKindFromTimestamps({
      addedThreadIds,
      cachedThreadTimestamps: input.cachedThreadTimestamps,
      currentThreadTimestamps: input.currentThreadTimestamps,
      removedThreadIds,
    }) ??
    inferKindFromThreadOrder({
      cachedThreadIds: input.cachedThreadIds,
      currentThreadIds: input.currentThreadIds,
    });

  return {
    addedThreadCount: addedThreadIds.length,
    changedThreadCount: Math.max(addedThreadIds.length, removedThreadIds.length),
    kind,
    removedThreadCount: removedThreadIds.length,
  };
}
