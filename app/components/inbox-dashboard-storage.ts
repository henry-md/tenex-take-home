"use client";

import type { InboxHomepageData } from "@/lib/inbox/classification";

export const INBOX_CACHE_STORAGE_KEY = "inbox-dashboard-cache";
export const INBOX_PENDING_SORT_REASON_STORAGE_KEY =
  "inbox-dashboard-pending-sort-reason";

const INBOX_PENDING_REFRESH_STORAGE_KEY = "inbox-dashboard-pending-refresh";
const PENDING_INBOX_REFRESH_MAX_AGE_MS = 10 * 60 * 1000;

type PendingInboxRefresh = {
  configuredThreadLimit: number;
  createdAt: number;
  reason: "thread-limit-change";
};

type InboxDashboardCacheStorage = {
  inboxesByThreadLimit: Record<string, InboxHomepageData>;
  version: 3;
};

function isInboxHomepageData(value: unknown): value is InboxHomepageData {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<InboxHomepageData>;

  return (
    typeof candidate.bucketCount === "number" &&
    Array.isArray(candidate.buckets) &&
    typeof candidate.configuredThreadLimit === "number" &&
    typeof candidate.totalThreads === "number"
  );
}

function createInboxDashboardCacheStorage(
  inboxesByThreadLimit: Record<string, InboxHomepageData> = {},
): InboxDashboardCacheStorage {
  return {
    inboxesByThreadLimit,
    version: 3,
  };
}

function readInboxDashboardCacheStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(INBOX_CACHE_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as
      | InboxDashboardCacheStorage
      | InboxHomepageData;

    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      parsed.version === 3 &&
      "inboxesByThreadLimit" in parsed &&
      parsed.inboxesByThreadLimit &&
      typeof parsed.inboxesByThreadLimit === "object"
    ) {
      const inboxesByThreadLimit = Object.fromEntries(
        Object.entries(parsed.inboxesByThreadLimit).filter(([, inbox]) =>
          isInboxHomepageData(inbox),
        ),
      );

      return createInboxDashboardCacheStorage(inboxesByThreadLimit);
    }

    if (isInboxHomepageData(parsed)) {
      return createInboxDashboardCacheStorage({
        [String(parsed.configuredThreadLimit)]: parsed,
      });
    }
  } catch {
    // Fall through to clearing the corrupted storage entry.
  }

  window.localStorage.removeItem(INBOX_CACHE_STORAGE_KEY);

  return null;
}

function writeInboxDashboardCacheStorage(storage: InboxDashboardCacheStorage) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(INBOX_CACHE_STORAGE_KEY, JSON.stringify(storage));
}

export function clearCachedInbox(configuredThreadLimit?: number) {
  if (typeof window === "undefined") {
    return;
  }

  if (typeof configuredThreadLimit !== "number") {
    window.localStorage.removeItem(INBOX_CACHE_STORAGE_KEY);
    return;
  }

  const storage = readInboxDashboardCacheStorage();

  if (!storage) {
    return;
  }

  const inboxesByThreadLimit = { ...storage.inboxesByThreadLimit };

  delete inboxesByThreadLimit[String(configuredThreadLimit)];

  if (Object.keys(inboxesByThreadLimit).length === 0) {
    window.localStorage.removeItem(INBOX_CACHE_STORAGE_KEY);
    return;
  }

  writeInboxDashboardCacheStorage(
    createInboxDashboardCacheStorage(inboxesByThreadLimit),
  );
}

export function readCachedInboxesFromStorage() {
  const storage = readInboxDashboardCacheStorage();

  if (!storage) {
    return [];
  }

  return Object.values(storage.inboxesByThreadLimit);
}

export function readCachedInboxFromStorage(expectedThreadLimit?: number) {
  const storage = readInboxDashboardCacheStorage();

  if (!storage) {
    return null;
  }

  if (typeof expectedThreadLimit === "number") {
    const exactInbox =
      storage.inboxesByThreadLimit[String(expectedThreadLimit)] ?? null;

    if (exactInbox) {
      return exactInbox;
    }

    const smallerCompatibleInboxes = Object.values(storage.inboxesByThreadLimit)
      .filter(
        (inbox) => inbox.configuredThreadLimit <= expectedThreadLimit,
      )
      .sort(
        (left, right) =>
          right.configuredThreadLimit - left.configuredThreadLimit,
      );

    return smallerCompatibleInboxes[0] ?? null;
  }

  return Object.values(storage.inboxesByThreadLimit)[0] ?? null;
}

export function writeCachedInboxToStorage(inbox: InboxHomepageData) {
  const storage =
    readInboxDashboardCacheStorage() ?? createInboxDashboardCacheStorage();

  writeInboxDashboardCacheStorage(
    createInboxDashboardCacheStorage({
      ...storage.inboxesByThreadLimit,
      [String(inbox.configuredThreadLimit)]: inbox,
    }),
  );
}

export function readPendingInboxRefresh() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(INBOX_PENDING_REFRESH_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as PendingInboxRefresh;

    if (
      !parsed ||
      parsed.reason !== "thread-limit-change" ||
      typeof parsed.configuredThreadLimit !== "number" ||
      typeof parsed.createdAt !== "number" ||
      Date.now() - parsed.createdAt > PENDING_INBOX_REFRESH_MAX_AGE_MS
    ) {
      clearPendingInboxRefresh();
      return null;
    }

    return parsed;
  } catch {
    clearPendingInboxRefresh();
    return null;
  }
}

export function clearPendingInboxRefresh() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(INBOX_PENDING_REFRESH_STORAGE_KEY);
}

export function markPendingInboxRefresh(configuredThreadLimit: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(
    INBOX_PENDING_REFRESH_STORAGE_KEY,
    JSON.stringify({
      configuredThreadLimit,
      createdAt: Date.now(),
      reason: "thread-limit-change",
    } satisfies PendingInboxRefresh),
  );
}
