"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
} from "react";
import {
  ChevronRight,
  Inbox,
  LoaderCircle,
  Sparkles,
  X,
} from "lucide-react";
import { toast } from "sonner";

import type {
  InboxHomepageData,
  InboxThreadItem,
} from "@/lib/inbox/classification";

type InboxDashboardProps = {
  firstName?: string;
  initialInboxThreadLimit: number;
};

type BucketTone = {
  badgeClassName: string;
  bodyClassName: string;
  summaryClassName: string;
};

const BUCKET_TONES: Record<string, BucketTone> = {
  "Auto-archive": {
    badgeClassName: "border-emerald-200 bg-emerald-100 text-emerald-800",
    bodyClassName: "bg-white",
    summaryClassName: "bg-emerald-50/80",
  },
  "Can wait": {
    badgeClassName: "border-slate-200 bg-slate-100 text-slate-700",
    bodyClassName: "bg-white",
    summaryClassName: "bg-slate-50/80",
  },
  Finance: {
    badgeClassName: "border-blue-200 bg-blue-100 text-blue-800",
    bodyClassName: "bg-white",
    summaryClassName: "bg-blue-50/75",
  },
  Important: {
    badgeClassName: "border-amber-200 bg-amber-100 text-amber-900",
    bodyClassName: "bg-white",
    summaryClassName: "bg-amber-50/85",
  },
  Newsletter: {
    badgeClassName: "border-fuchsia-200 bg-fuchsia-100 text-fuchsia-800",
    bodyClassName: "bg-white",
    summaryClassName: "bg-fuchsia-50/75",
  },
  Personal: {
    badgeClassName: "border-rose-200 bg-rose-100 text-rose-800",
    bodyClassName: "bg-white",
    summaryClassName: "bg-rose-50/75",
  },
};

const INBOX_LOAD_TOAST_DURATION_MS = 120_000;
const INBOX_STATUS_POLL_INTERVAL_MS = 60_000;
const INBOX_CACHE_STORAGE_KEY = "inbox-dashboard-cache";
const INBOX_PENDING_SORT_REASON_STORAGE_KEY = "inbox-dashboard-pending-sort-reason";
const PENDING_SORT_REASON_MAX_AGE_MS = 10 * 60 * 1000;

type PersistedPendingSortReason = {
  bucketName: string;
  createdAt: number;
  reason: "new-bucket";
};

function formatThreadTimestamp(value: string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
  }).format(date);
}

function getBucketTone(name: string): BucketTone {
  return (
    BUCKET_TONES[name] ?? {
      badgeClassName: "border-stone-200 bg-stone-100 text-stone-700",
      bodyClassName: "bg-white",
      summaryClassName: "bg-stone-50/80",
    }
  );
}

function ThreadRow({ thread }: { thread: InboxThreadItem }) {
  return (
    <details className="group overflow-hidden border-b border-slate-200 bg-white last:border-b-0">
      <summary className="cursor-pointer list-none px-4 py-3 transition hover:bg-slate-50 [&::-webkit-details-marker]:hidden md:px-5">
        <div className="flex items-start gap-3">
          <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
            <ChevronRight
              aria-hidden="true"
              className="details-chevron h-2.5 w-2.5"
              strokeWidth={2.25}
            />
          </span>
          <div className="grid min-w-0 flex-1 gap-2 md:grid-cols-[minmax(0,13rem)_minmax(0,1fr)_auto] md:items-start">
            <div className="min-w-0">
              <p className="truncate text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">
                {thread.sender ?? "Unknown sender"}
              </p>
            </div>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-slate-950">
                {thread.subject}
              </p>
              <p className="truncate text-sm text-slate-500">
                {thread.preview}
              </p>
            </div>
            <p className="shrink-0 text-xs text-slate-500 md:text-right">
              {formatThreadTimestamp(thread.lastMessageAt)}
            </p>
          </div>
        </div>
      </summary>
      <div className="border-t border-slate-200 bg-slate-50 px-4 py-4 md:px-5">
        <p className="whitespace-pre-wrap text-sm leading-6 text-slate-600">
          {thread.preview}
        </p>
      </div>
    </details>
  );
}

type InboxHomepageResponse = {
  gmailFetch: {
    durationMs: number;
    fetchedThreadCount: number;
  };
  inbox: InboxHomepageData;
  sorting: {
    cacheHit: boolean;
    durationMs: number;
    sortedEmailCount: number;
  };
};

type InboxRefreshStatusResponse = {
  checkedAt: string;
  hasUpdates: boolean;
  unsortedThreadCount: number;
};

type BackgroundSyncState = "idle" | "checking" | "refreshing";
type ActiveSyncIndicator =
  | {
      bucketName: string;
      kind: "new-bucket";
    }
  | {
      emailCount: number;
      kind: "new-email";
    };

function readCachedInboxFromStorage() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(INBOX_CACHE_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    return JSON.parse(rawValue) as InboxHomepageData;
  } catch {
    window.localStorage.removeItem(INBOX_CACHE_STORAGE_KEY);
    return null;
  }
}

function writeCachedInboxToStorage(inbox: InboxHomepageData) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(INBOX_CACHE_STORAGE_KEY, JSON.stringify(inbox));
}

function readPendingSortReason() {
  if (typeof window === "undefined") {
    return null;
  }

  const rawValue = window.localStorage.getItem(INBOX_PENDING_SORT_REASON_STORAGE_KEY);

  if (!rawValue) {
    return null;
  }

  try {
    const parsed = JSON.parse(rawValue) as PersistedPendingSortReason;

    if (
      !parsed ||
      parsed.reason !== "new-bucket" ||
      typeof parsed.createdAt !== "number" ||
      typeof parsed.bucketName !== "string" ||
      Date.now() - parsed.createdAt > PENDING_SORT_REASON_MAX_AGE_MS
    ) {
      window.localStorage.removeItem(INBOX_PENDING_SORT_REASON_STORAGE_KEY);
      return null;
    }

    return parsed;
  } catch {
    window.localStorage.removeItem(INBOX_PENDING_SORT_REASON_STORAGE_KEY);
    return null;
  }
}

function clearPendingSortReason() {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.removeItem(INBOX_PENDING_SORT_REASON_STORAGE_KEY);
}

function truncateBucketName(name: string, maxLength: number) {
  return name.slice(0, maxLength).trimEnd();
}

function getActiveSyncLabel(indicator: ActiveSyncIndicator) {
  if (indicator.kind === "new-email") {
    return `Syncing ${indicator.emailCount} new email${indicator.emailCount === 1 ? "" : "s"}`;
  }

  return `Filling new bucket: ${truncateBucketName(indicator.bucketName, 15)}`;
}

function formatDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function showInboxLoadToasts(payload: InboxHomepageResponse) {
  if (payload.gmailFetch.durationMs === 0) {
    toast.success(
      payload.sorting.cacheHit
        ? "Loaded cached inbox snapshot."
        : "Loaded cached inbox snapshot and refreshed bucket memberships.",
      { duration: INBOX_LOAD_TOAST_DURATION_MS },
    );
    return;
  }

  toast.success(
    `Fetched ${payload.gmailFetch.fetchedThreadCount} Gmail thread${payload.gmailFetch.fetchedThreadCount === 1 ? "" : "s"} in ${formatDuration(payload.gmailFetch.durationMs)}.`,
    { duration: INBOX_LOAD_TOAST_DURATION_MS },
  );
  toast.success(
    `Inbox sorting finished in ${formatDuration(payload.sorting.durationMs)}${payload.sorting.cacheHit ? " (cache hit)." : "."}`,
    { duration: INBOX_LOAD_TOAST_DURATION_MS },
  );
}

async function fetchInboxHomepage(options?: { refresh?: boolean }) {
  const searchParams = new URLSearchParams();

  if (options?.refresh) {
    searchParams.set("refresh", "1");
  }

  const response = await fetch(
    `/api/inbox${searchParams.size ? `?${searchParams.toString()}` : ""}`,
    {
    cache: "no-store",
    },
  );

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
        }
      | null;

    throw new Error(payload?.error ?? "Unable to load inbox buckets.");
  }

  return (await response.json()) as InboxHomepageResponse;
}

async function fetchInboxRefreshStatus() {
  const response = await fetch("/api/inbox-status", {
    cache: "no-store",
  });

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
        }
      | null;

    throw new Error(payload?.error ?? "Unable to check for inbox updates.");
  }

  return (await response.json()) as InboxRefreshStatusResponse;
}

export function InboxDashboard({
  firstName,
  initialInboxThreadLimit,
}: InboxDashboardProps) {
  const initialLoadStartedRef = useRef(false);
  const initialBackgroundSyncStartedRef = useRef(false);
  const isMountedRef = useRef(true);
  const hydratedFromStorageRef = useRef(false);
  const loadedCachedSnapshotRef = useRef(false);
  const latestLoadRequestIdRef = useRef(0);
  const [inbox, setInbox] = useState<InboxHomepageData | null>(null);
  const [backgroundSyncState, setBackgroundSyncState] =
    useState<BackgroundSyncState>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isSorting, setIsSorting] = useState(true);
  const [activeSyncIndicator, setActiveSyncIndicator] =
    useState<ActiveSyncIndicator | null>(null);

  const loadInbox = useEffectEvent(async (options?: {
    isInitialLoad?: boolean;
    refresh?: boolean;
    showSuccessToast?: boolean;
    showSortingOverlay?: boolean;
    silent?: boolean;
  }) => {
    const requestId = latestLoadRequestIdRef.current + 1;

    latestLoadRequestIdRef.current = requestId;

    if (options?.isInitialLoad) {
      setIsLoading(!hydratedFromStorageRef.current);
    }

    setErrorMessage(null);

    if (options?.showSortingOverlay ?? true) {
      setIsSorting(true);
    }

    try {
      const payload = await fetchInboxHomepage({
        refresh: options?.refresh ?? !options?.isInitialLoad,
      });

      if (!isMountedRef.current || latestLoadRequestIdRef.current !== requestId) {
        return;
      }

      loadedCachedSnapshotRef.current = payload.gmailFetch.durationMs === 0;
      setInbox(payload.inbox);
      writeCachedInboxToStorage(payload.inbox);

      if (options?.showSuccessToast) {
        showInboxLoadToasts(payload);
      }
    } catch (error) {
      if (!isMountedRef.current || latestLoadRequestIdRef.current !== requestId) {
        return;
      }

      const message =
        error instanceof Error ? error.message : "Unable to load inbox buckets.";

      setErrorMessage(message);

      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      if (!isMountedRef.current || latestLoadRequestIdRef.current !== requestId) {
        return;
      }

      setIsLoading(false);
      setActiveSyncIndicator(null);
      clearPendingSortReason();

      if (options?.showSortingOverlay ?? true) {
        setIsSorting(false);
      }
    }
  });

  async function checkForUpdates() {
    const payload = await fetchInboxRefreshStatus();

    return payload;
  }

  const syncLatestEmailsIfNeeded = useEffectEvent(async () => {
    if (
      backgroundSyncState !== "idle" ||
      isLoading ||
      isSorting
    ) {
      return;
    }

    setBackgroundSyncState("checking");

    try {
      const status = await checkForUpdates();

      if (!isMountedRef.current || !status.hasUpdates) {
        return;
      }

      setBackgroundSyncState("refreshing");
      setActiveSyncIndicator({
        emailCount: status.unsortedThreadCount,
        kind: "new-email",
      });
      await loadInbox({
        refresh: true,
        showSuccessToast: true,
        showSortingOverlay: false,
        silent: true,
      });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }

      console.error("Background inbox sync failed", error);
    } finally {
      if (!isMountedRef.current) {
        return;
      }

      setBackgroundSyncState("idle");
    }
  });

  useEffect(() => {
    isMountedRef.current = true;

    const cachedInbox = readCachedInboxFromStorage();
    const storedValue = window.localStorage.getItem("inbox-dashboard-hero-hidden");
    const pendingSortReason = readPendingSortReason();

    if (cachedInbox) {
      hydratedFromStorageRef.current = true;
      setInbox(cachedInbox);
      setIsLoading(false);
      setIsSorting(false);
    }

    if (pendingSortReason && cachedInbox) {
      setActiveSyncIndicator({
        bucketName: pendingSortReason.bucketName,
        kind: "new-bucket",
      });
    }

    if (storedValue === "true") {
      setIsHeroVisible(false);
    }

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Prevent the development Strict Mode effect replay from issuing a second
    // inbox load that immediately recreates and reuses the cache we just cleared.
    if (initialLoadStartedRef.current) {
      return;
    }

    initialLoadStartedRef.current = true;

    void loadInbox({
      isInitialLoad: true,
      showSuccessToast: true,
      showSortingOverlay: !hydratedFromStorageRef.current,
      silent: true,
    });
  }, []);

  useEffect(() => {
    if (!inbox || initialBackgroundSyncStartedRef.current || !loadedCachedSnapshotRef.current) {
      return;
    }

    initialBackgroundSyncStartedRef.current = true;
    void syncLatestEmailsIfNeeded();
  }, [inbox]);

  useEffect(() => {
    if (!inbox) {
      return;
    }

    async function pollForUpdates() {
      if (document.visibilityState === "hidden") {
        return;
      }

      await syncLatestEmailsIfNeeded();
    }

    const intervalId = window.setInterval(() => {
      void pollForUpdates();
    }, INBOX_STATUS_POLL_INTERVAL_MS);
    const handleVisibilityChange = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void pollForUpdates();
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [inbox]);

  function handleDismissHero() {
    setIsHeroVisible(false);
    window.localStorage.setItem("inbox-dashboard-hero-hidden", "true");
  }

  const importantCount =
    inbox?.buckets.find((bucket) => bucket.name === "Important")?.count ?? 0;
  const configuredThreadLimit =
    inbox?.configuredThreadLimit ?? initialInboxThreadLimit;
  const activeSyncLabel = activeSyncIndicator
    ? getActiveSyncLabel(activeSyncIndicator)
    : null;

  return (
    <section className="space-y-6">
      {activeSyncLabel ? (
        <div className="sticky top-4 z-20 flex justify-end">
          <div className="w-full max-w-sm rounded-[1.2rem] border border-sky-200 bg-[linear-gradient(180deg,rgba(240,249,255,0.98),rgba(224,242,254,0.92))] px-4 py-3 shadow-[0_20px_50px_rgba(14,116,144,0.14)] backdrop-blur">
            <div className="flex items-center gap-2 text-sm font-semibold text-sky-950">
              <LoaderCircle
                aria-hidden="true"
                className="h-4 w-4 animate-spin"
                strokeWidth={2}
              />
              <span className="min-w-0 truncate">{activeSyncLabel}</span>
            </div>
            {activeSyncIndicator.kind === "new-email" ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-sky-100">
                <div className="h-full w-2/5 animate-pulse rounded-full bg-sky-500" />
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isHeroVisible ? (
        <header className="overflow-hidden rounded-[2rem] border border-white/70 bg-[linear-gradient(135deg,rgba(255,250,240,0.96),rgba(255,255,255,0.92)_45%,rgba(240,249,255,0.9))] p-6 shadow-[0_30px_90px_rgba(15,23,42,0.08)] backdrop-blur md:p-8">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 bg-white/75 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
                <Sparkles
                  aria-hidden="true"
                  className="h-3.5 w-3.5"
                  strokeWidth={2}
                />
                LLM inbox buckets
              </div>
              <div className="mt-4 flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
                <div className="space-y-3">
                  <h1 className="max-w-3xl text-3xl font-semibold tracking-tight text-slate-950 md:text-5xl">
                    {firstName
                      ? `${firstName}, here is your inbox triage board.`
                      : "Here is your inbox triage board."}
                  </h1>
                  <p className="max-w-2xl text-sm leading-7 text-slate-600 md:text-base">
                    Your latest {configuredThreadLimit} inbox threads are
                    grouped into clear buckets so you can scan the whole inbox
                    like a triage board instead of a raw chronological list.
                  </p>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-[1.5rem] border border-white/80 bg-white/80 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Threads loaded
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {inbox?.totalThreads ?? configuredThreadLimit}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/80 bg-white/80 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Important
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {importantCount}
                    </p>
                  </div>
                  <div className="rounded-[1.5rem] border border-white/80 bg-white/80 p-4">
                    <p className="text-xs uppercase tracking-[0.18em] text-slate-400">
                      Buckets
                    </p>
                    <p className="mt-2 text-2xl font-semibold text-slate-950">
                      {inbox?.bucketCount ?? 0}
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <button
              aria-label="Dismiss triage board overview"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white/80 text-slate-500 transition hover:border-slate-300 hover:text-slate-700"
              onClick={handleDismissHero}
              type="button"
            >
              <X aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>
        </header>
      ) : null}

      {errorMessage && !inbox ? (
        <section className="rounded-[1.75rem] border border-rose-200 bg-rose-50 px-5 py-4 text-sm text-rose-700">
          {errorMessage}
        </section>
      ) : null}

      {isLoading ? (
        <section className="rounded-[2rem] border border-white/70 bg-white/88 px-6 py-16 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur">
          <div className="mx-auto flex max-w-2xl flex-col items-center text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-full bg-slate-950 text-white shadow-[0_18px_45px_rgba(15,23,42,0.18)]">
              <LoaderCircle
                aria-hidden="true"
                className="h-6 w-6 animate-spin"
                strokeWidth={2}
              />
            </span>
            <h2 className="mt-6 text-2xl font-semibold tracking-tight text-slate-950">
              Sorting your inbox
            </h2>
            <p className="mt-3 max-w-xl text-sm leading-7 text-slate-600">
              Fetching recent emails and grouping them into your configured
              buckets now.
            </p>
          </div>
        </section>
      ) : null}

      {inbox ? (
        <div className="space-y-4">
          {isSorting ? (
            <section className="rounded-[1.5rem] border border-sky-200 bg-[linear-gradient(180deg,rgba(240,249,255,0.98),rgba(224,242,254,0.92))] px-5 py-4 text-sm text-sky-900 shadow-[0_18px_45px_rgba(14,116,144,0.08)]">
              <div className="flex items-center gap-3">
                <LoaderCircle
                  aria-hidden="true"
                  className="h-4 w-4 animate-spin"
                  strokeWidth={2}
                />
                <div className="min-w-0 flex-1">
                  <p className="font-semibold">Sorting your inbox</p>
                  <p className="text-sky-800/80">
                    Fetching recent emails and grouping them into your configured buckets now.
                  </p>
                </div>
              </div>
            </section>
          ) : null}
          {inbox.buckets.map((bucket) => {
            const tone = getBucketTone(bucket.name);

            return (
              <details
                key={bucket.id}
                className="group overflow-hidden rounded-[1.75rem] border border-slate-200 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.07)] transition-shadow hover:shadow-[0_28px_70px_rgba(15,23,42,0.09)]"
                open
              >
                <summary
                  className={`cursor-pointer list-none rounded-[1.75rem] px-5 py-5 outline outline-1 outline-transparent transition hover:bg-black/0.02 group-open:rounded-b-none group-open:border-b group-open:border-slate-200 [&::-webkit-details-marker]:hidden ${tone.summaryClassName}`}
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="mt-1 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500">
                        <ChevronRight
                          aria-hidden="true"
                          className="details-chevron h-3 w-3"
                          strokeWidth={2.25}
                        />
                      </span>
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-xl font-semibold tracking-tight text-slate-950">
                        {bucket.name}
                      </h2>
                          <span
                            className={`rounded-full border px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] ${tone.badgeClassName}`}
                          >
                            {bucket.count}
                          </span>
                          {bucket.isCustom ? (
                            <span className="rounded-full border border-stone-200 bg-stone-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-stone-700">
                              Custom
                            </span>
                          ) : null}
                        </div>
                      </div>
                    </div>
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/80 bg-white/70 px-3 py-1.5 text-xs font-medium text-slate-500">
                      <Inbox aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2} />
                      {bucket.count} thread{bucket.count === 1 ? "" : "s"}
                    </div>
                  </div>
                </summary>

                {bucket.threads.length ? (
                  <div className={`${tone.bodyClassName} outline outline-1 outline-slate-200/70 outline-offset-[-1px]`}>
                    {bucket.threads.map((thread) => (
                      <ThreadRow key={thread.threadId} thread={thread} />
                    ))}
                  </div>
                ) : (
                  <div
                    className={`${tone.bodyClassName} rounded-b-[1.75rem] px-4 py-8 text-center text-sm text-slate-500 outline outline-1 outline-slate-200/70 outline-offset-[-1px]`}
                  >
                    Nothing landed here in the current {configuredThreadLimit}-thread pass.
                  </div>
                )}
              </details>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
