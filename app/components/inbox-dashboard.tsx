"use client";

import {
  startTransition,
  useEffect,
  useState,
} from "react";
import {
  ChevronRight,
  Inbox,
  LoaderCircle,
  RefreshCw,
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
              className="h-2.5 w-2.5 transition-transform duration-200 group-open:rotate-90"
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
  inbox: InboxHomepageData;
  sorting: {
    cacheHit: boolean;
    durationMs: number;
    sortedEmailCount: number;
  };
};

function formatSortDuration(durationMs: number) {
  if (durationMs < 1000) {
    return `${durationMs}ms`;
  }

  return `${(durationMs / 1000).toFixed(durationMs >= 10_000 ? 0 : 1)}s`;
}

function showSortingCompleteToast(sortedEmailCount: number, durationMs: number) {
  toast.success(
    `${sortedEmailCount} emails sorted in ${formatSortDuration(durationMs)}.`,
    { duration: Infinity },
  );
}

async function fetchInboxHomepage() {
  const response = await fetch("/api/inbox");

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

export function InboxDashboard({
  firstName,
  initialInboxThreadLimit,
}: InboxDashboardProps) {
  const [inbox, setInbox] = useState<InboxHomepageData | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isHeroVisible, setIsHeroVisible] = useState(true);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSorting, setIsSorting] = useState(true);

  async function loadInbox(options?: { showSuccessToast?: boolean; silent?: boolean }) {
    setIsSorting(true);

    try {
      const payload = await fetchInboxHomepage();

      startTransition(() => {
        setErrorMessage(null);
        setInbox(payload.inbox);
      });

      if (options?.showSuccessToast) {
        showSortingCompleteToast(
          payload.sorting.sortedEmailCount,
          payload.sorting.durationMs,
        );
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unable to load inbox buckets.";

      setErrorMessage(message);

      if (!options?.silent) {
        toast.error(message);
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
      setIsSorting(false);
    }
  }

  useEffect(() => {
    const storedValue = window.localStorage.getItem("inbox-dashboard-hero-hidden");

    if (storedValue === "true") {
      setIsHeroVisible(false);
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    void (async () => {
      setIsSorting(true);

      try {
        const payload = await fetchInboxHomepage();

        if (!isActive) {
          return;
        }

        startTransition(() => {
          setErrorMessage(null);
          setInbox(payload.inbox);
        });

        showSortingCompleteToast(
          payload.sorting.sortedEmailCount,
          payload.sorting.durationMs,
        );
      } catch (error) {
        if (!isActive) {
          return;
        }

        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Unable to load inbox buckets.",
        );
      } finally {
        if (!isActive) {
          return;
        }

        setIsLoading(false);
        setIsSorting(false);
      }
    })();

    return () => {
      isActive = false;
    };
  }, []);

  async function handleRefresh() {
    if (isRefreshing) {
      return;
    }

    setIsRefreshing(true);
    await loadInbox({ showSuccessToast: true });
  }

  function handleDismissHero() {
    setIsHeroVisible(false);
    window.localStorage.setItem("inbox-dashboard-hero-hidden", "true");
  }

  const importantCount =
    inbox?.buckets.find((bucket) => bucket.name === "Important")?.count ?? 0;
  const configuredThreadLimit =
    inbox?.configuredThreadLimit ?? initialInboxThreadLimit;

  return (
    <section className="space-y-6">
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

      <section className="flex flex-col gap-4 rounded-[1.75rem] border border-white/70 bg-white/85 p-5 shadow-[0_30px_80px_rgba(15,23,42,0.08)] backdrop-blur lg:flex-row lg:items-center lg:justify-between">
        <div className="space-y-1">
          <p className="text-sm font-semibold text-slate-950">Inbox view</p>
          <p className="text-sm text-slate-500">
            Buckets and classifier prompts now live in Settings. Refresh to rerun
            categorization on the latest inbox snapshot.
          </p>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
            disabled={isRefreshing}
            onClick={() => void handleRefresh()}
            type="button"
          >
            <RefreshCw
              aria-hidden="true"
              className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              strokeWidth={2}
            />
            Refresh
          </button>
        </div>
      </section>

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
        <div className="relative space-y-4">
          {isSorting ? (
            <div className="pointer-events-none absolute inset-0 z-10 rounded-[2rem] bg-white/72 backdrop-blur-[2px]">
              <div className="flex h-full items-center justify-center p-6">
                <div className="rounded-[1.5rem] border border-slate-200 bg-white/95 px-6 py-5 text-center shadow-[0_24px_60px_rgba(15,23,42,0.12)]">
                  <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-slate-950 text-white">
                    <LoaderCircle
                      aria-hidden="true"
                      className="h-5 w-5 animate-spin"
                      strokeWidth={2}
                    />
                  </div>
                  <p className="mt-4 text-base font-semibold text-slate-950">
                    Sorting your inbox
                  </p>
                  <p className="mt-1 text-sm text-slate-500">
                    Re-running bucket classification now.
                  </p>
                </div>
              </div>
            </div>
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
                          className="h-3 w-3 transition-transform duration-200 group-open:rotate-90"
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
