export type InboxLoadFeedback = {
  gmailFetch: {
    cacheHit: boolean;
    durationMs: number;
    fetchedThreadCount: number;
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
  const messages: string[] = [];

  if (payload.gmailFetch.cacheHit) {
    messages.push(`Gmail thread cache hit: loaded ${threadCount} ${threadLabel} from cache.`);
  } else {
    messages.push(
      `Fetched ${threadCount} Gmail ${threadLabel} in ${formatInboxLoadDuration(payload.gmailFetch.durationMs)}.`,
    );
  }

  if (payload.sorting.cacheHit) {
    messages.push(
      `Inbox sorting cache hit: reused cached bucket memberships in ${formatInboxLoadDuration(payload.sorting.durationMs)}.`,
    );
    return messages;
  }

  if (payload.gmailFetch.cacheHit) {
    messages.push(
      `Inbox sorting refreshed bucket memberships in ${formatInboxLoadDuration(payload.sorting.durationMs)}.`,
    );
    return messages;
  }

  messages.push(
    `Inbox sorting finished in ${formatInboxLoadDuration(payload.sorting.durationMs)}.`,
  );

  return messages;
}
