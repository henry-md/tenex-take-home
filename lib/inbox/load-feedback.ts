export type InboxLoadFeedback = {
  gmailFetch: {
    addedThreadCount: number;
    cacheHit: boolean;
    changedThreadCount: number;
    durationMs: number;
    fetchedThreadCount: number;
    kind: "deleted-threads" | "mixed" | "new-threads" | "none";
    removedThreadCount: number;
  };
  sorting: {
    cacheHit: boolean;
    durationMs: number;
    sortedEmailCount: number;
  };
};

export function formatInboxLoadDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

export function getInboxLoadToastMessages(payload: InboxLoadFeedback) {
  const threadCount = payload.gmailFetch.fetchedThreadCount;
  const threadLabel = `thread${threadCount === 1 ? "" : "s"}`;
  const changedThreadCount = payload.gmailFetch.changedThreadCount;
  const changedThreadLabel = `thread${changedThreadCount === 1 ? "" : "s"}`;
  const removedThreadCount = payload.gmailFetch.removedThreadCount;
  const messages: string[] = [];

  if (payload.gmailFetch.cacheHit) {
    messages.push(`Gmail thread cache hit: loaded ${threadCount} ${threadLabel} from cache.`);
  } else if (
    payload.gmailFetch.kind === "new-threads" &&
    changedThreadCount > 0 &&
    changedThreadCount < threadCount
  ) {
    messages.push(
      `Synced ${changedThreadCount} new Gmail ${changedThreadLabel} in ${formatInboxLoadDuration(payload.gmailFetch.durationMs)}.`,
    );
  } else if (payload.gmailFetch.kind === "deleted-threads" && removedThreadCount > 0) {
    messages.push(
      `Synced ${removedThreadCount} Gmail deletion${removedThreadCount === 1 ? "" : "s"} and refreshed the latest ${threadCount} ${threadLabel} in ${formatInboxLoadDuration(payload.gmailFetch.durationMs)}.`,
    );
  } else if (changedThreadCount > 0 && changedThreadCount < threadCount) {
    messages.push(
      `Synced ${changedThreadCount} Gmail thread change${changedThreadCount === 1 ? "" : "s"} in ${formatInboxLoadDuration(payload.gmailFetch.durationMs)}.`,
    );
  } else {
    messages.push(
      `Fetched ${threadCount} Gmail ${threadLabel} in ${formatInboxLoadDuration(payload.gmailFetch.durationMs)}.`,
    );
  }

  if (payload.sorting.cacheHit) {
    messages.push(
      `Inbox cache hit: reused cached bucket memberships in ${formatInboxLoadDuration(payload.sorting.durationMs)}.`,
    );
    return messages;
  }

  if (payload.gmailFetch.cacheHit) {
    messages.push(
      `Inbox cache refresh updated bucket memberships in ${formatInboxLoadDuration(payload.sorting.durationMs)}.`,
    );
    return messages;
  }

  messages.push(
    `Inbox refresh and cache update finished in ${formatInboxLoadDuration(payload.sorting.durationMs)}.`,
  );

  return messages;
}
