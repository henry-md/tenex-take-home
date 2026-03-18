"use client";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/app/components/ui/alert-dialog";
import { GripVertical, Plus, RotateCcw, Save, Trash2 } from "lucide-react";
import {
  type DragEvent,
  type PointerEvent as ReactPointerEvent,
  type TextareaHTMLAttributes,
  useEffect,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { toast } from "sonner";

import {
  clearCachedInbox,
  INBOX_PENDING_SORT_REASON_STORAGE_KEY,
  readCachedInboxesFromStorage,
  writeCachedInboxToStorage,
} from "@/app/components/inbox-dashboard-storage";
import type { BucketSetting } from "@/lib/inbox/classification";

type BucketSettingsProps = {
  initialHasInboxCache: boolean;
  initialBuckets: BucketSetting[];
  showDebugCacheControls: boolean;
};

function resizeTextarea(element: HTMLTextAreaElement) {
  element.style.height = "0px";
  element.style.height = `${element.scrollHeight}px`;
}

function AutoResizeTextarea({
  className,
  onInput,
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (!textareaRef.current) {
      return;
    }

    resizeTextarea(textareaRef.current);
  }, [props.value]);

  return (
    <textarea
      {...props}
      className={className}
      onInput={(event) => {
        resizeTextarea(event.currentTarget);
        onInput?.(event);
      }}
      ref={textareaRef}
    />
  );
}

function moveBucket(
  buckets: BucketSetting[],
  draggedBucketId: string,
  targetBucketId: string,
) {
  const draggedIndex = buckets.findIndex((bucket) => bucket.id === draggedBucketId);
  const targetIndex = buckets.findIndex((bucket) => bucket.id === targetBucketId);

  if (
    draggedIndex === -1 ||
    targetIndex === -1 ||
    draggedIndex === targetIndex
  ) {
    return buckets;
  }

  const nextBuckets = [...buckets];
  const [draggedBucket] = nextBuckets.splice(draggedIndex, 1);

  nextBuckets.splice(targetIndex, 0, draggedBucket);

  return nextBuckets;
}

function isDragExemptTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    Boolean(target.closest('textarea, [data-drag-exempt="true"]'))
  );
}

function syncCachedInboxBucketOrder(buckets: BucketSetting[]) {
  const cachedInboxes = readCachedInboxesFromStorage();

  if (cachedInboxes.length === 0) {
    return;
  }

  const bucketIdsInOrder = new Map(
    buckets.map((bucket, index) => [bucket.id, index]),
  );

  for (const cachedInbox of cachedInboxes) {
    writeCachedInboxToStorage({
      ...cachedInbox,
      buckets: [...cachedInbox.buckets].sort((left, right) => {
        const leftIndex = bucketIdsInOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
        const rightIndex = bucketIdsInOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;

        if (leftIndex !== rightIndex) {
          return leftIndex - rightIndex;
        }

        return left.name.localeCompare(right.name);
      }),
    });
  }
}

export function BucketSettings({
  initialHasInboxCache,
  initialBuckets,
  showDebugCacheControls,
}: BucketSettingsProps) {
  const [buckets, setBuckets] = useState(initialBuckets);
  const [draftPrompts, setDraftPrompts] = useState(
    Object.fromEntries(initialBuckets.map((bucket) => [bucket.id, bucket.prompt])),
  );
  const [newBucketName, setNewBucketName] = useState("");
  const [newBucketPrompt, setNewBucketPrompt] = useState("");
  const [isCreatingBucket, setIsCreatingBucket] = useState(false);
  const [hasInboxCache, setHasInboxCache] = useState(initialHasInboxCache);
  const [isInvalidatingCache, setIsInvalidatingCache] = useState(false);
  const [isReorderingBuckets, setIsReorderingBuckets] = useState(false);
  const [isResettingDefaults, setIsResettingDefaults] = useState(false);
  const [savingBucketId, setSavingBucketId] = useState<string | null>(null);
  const [deletingBucketId, setDeletingBucketId] = useState<string | null>(null);
  const [draggingBucketId, setDraggingBucketId] = useState<string | null>(null);
  const [dropTargetBucketId, setDropTargetBucketId] = useState<string | null>(null);
  const [armedDragBucketId, setArmedDragBucketId] = useState<string | null>(null);

  function syncBuckets(nextBuckets: BucketSetting[]) {
    setBuckets(nextBuckets);
    setDraftPrompts(
      Object.fromEntries(nextBuckets.map((bucket) => [bucket.id, bucket.prompt])),
    );
  }

  function clearLocalDashboardState() {
    clearCachedInbox();
    window.localStorage.removeItem(INBOX_PENDING_SORT_REASON_STORAGE_KEY);
  }

  async function persistBucketOrder(
    nextBuckets: BucketSetting[],
    previousBuckets: BucketSetting[],
  ) {
    setBuckets(nextBuckets);
    setIsReorderingBuckets(true);

    try {
      const response = await fetch("/api/buckets", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          bucketIds: nextBuckets.map((bucket) => bucket.id),
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to reorder buckets.");
      }

      const payload = (await response.json()) as {
        buckets: BucketSetting[];
      };

      syncCachedInboxBucketOrder(payload.buckets);
      setBuckets(payload.buckets);
    } catch (error) {
      setBuckets(previousBuckets);
      toast.error(
        error instanceof Error ? error.message : "Unable to reorder buckets.",
      );
    } finally {
      setIsReorderingBuckets(false);
    }
  }

  async function handleCreateBucket() {
    const trimmedName = newBucketName.trim();

    if (
      !trimmedName ||
      isCreatingBucket ||
      deletingBucketId ||
      isResettingDefaults
    ) {
      return;
    }

    setIsCreatingBucket(true);

    try {
      const response = await fetch("/api/buckets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: trimmedName,
          prompt: newBucketPrompt,
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to create bucket.");
      }

      const payload = (await response.json()) as {
        buckets: BucketSetting[];
      };

      if (hasInboxCache) {
        window.localStorage.setItem(
          INBOX_PENDING_SORT_REASON_STORAGE_KEY,
          JSON.stringify({
            bucketName: trimmedName,
            createdAt: Date.now(),
            reason: "new-bucket",
          }),
        );
      }

      syncBuckets(payload.buckets);
      setNewBucketName("");
      setNewBucketPrompt("");
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to create bucket.",
      );
    } finally {
      setIsCreatingBucket(false);
    }
  }

  async function handleSavePrompt(bucketId: string) {
    if (savingBucketId || deletingBucketId || isResettingDefaults) {
      return;
    }

    setSavingBucketId(bucketId);

    try {
      const response = await fetch(`/api/buckets/${bucketId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          prompt: draftPrompts[bucketId] ?? "",
        }),
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to save bucket prompt.");
      }

      const payload = (await response.json()) as {
        buckets: BucketSetting[];
      };

      syncBuckets(payload.buckets);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to save bucket prompt.",
      );
    } finally {
      setSavingBucketId(null);
    }
  }

  async function handleInvalidateCache() {
    if (isInvalidatingCache || deletingBucketId || isResettingDefaults) {
      return;
    }

    setIsInvalidatingCache(true);

    try {
      const response = await fetch("/api/inbox-cache", {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to invalidate inbox cache.");
      }

      clearLocalDashboardState();
      setHasInboxCache(false);
      toast.success("Inbox classification cache cleared.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to invalidate inbox cache.",
      );
    } finally {
      setIsInvalidatingCache(false);
    }
  }

  function handleDragStart(bucketId: string) {
    if (isReorderingBuckets || deletingBucketId || isResettingDefaults) {
      return;
    }

    setDraggingBucketId(bucketId);
    setDropTargetBucketId(bucketId);
  }

  function handleCardDragStart(
    event: DragEvent<HTMLElement>,
    bucketId: string,
  ) {
    if (
      isReorderingBuckets ||
      deletingBucketId ||
      isResettingDefaults ||
      isDragExemptTarget(event.target)
    ) {
      event.preventDefault();
      return;
    }

    if (armedDragBucketId !== bucketId) {
      event.preventDefault();
      return;
    }

    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", bucketId);

    const cardBounds = event.currentTarget.getBoundingClientRect();

    event.dataTransfer.setDragImage(
      event.currentTarget,
      event.clientX - cardBounds.left,
      event.clientY - cardBounds.top,
    );

    handleDragStart(bucketId);
  }

  function handleCardPointerDown(
    event: ReactPointerEvent<HTMLElement>,
    bucketId: string,
  ) {
    if (isReorderingBuckets || deletingBucketId || isResettingDefaults) {
      return;
    }

    flushSync(() => {
      setArmedDragBucketId(
        isDragExemptTarget(event.target) ? null : bucketId,
      );
    });
  }

  function handleDragOver(event: DragEvent<HTMLElement>, bucketId: string) {
    if (!draggingBucketId || draggingBucketId === bucketId) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropTargetBucketId(bucketId);
  }

  async function handleDrop(event: DragEvent<HTMLElement>, targetBucketId: string) {
    event.preventDefault();

    if (!draggingBucketId || draggingBucketId === targetBucketId) {
      setDraggingBucketId(null);
      setDropTargetBucketId(null);
      return;
    }

    const previousBuckets = buckets;
    const nextBuckets = moveBucket(buckets, draggingBucketId, targetBucketId);

    setDraggingBucketId(null);
    setDropTargetBucketId(null);

    if (nextBuckets === previousBuckets) {
      return;
    }

    await persistBucketOrder(nextBuckets, previousBuckets);
  }

  function handleDragEnd() {
    setArmedDragBucketId(null);
    setDraggingBucketId(null);
    setDropTargetBucketId(null);
  }

  async function handleDeleteBucket(bucket: BucketSetting) {
    if (
      deletingBucketId ||
      isResettingDefaults ||
      isCreatingBucket ||
      savingBucketId ||
      isReorderingBuckets ||
      isInvalidatingCache
    ) {
      return;
    }

    setDeletingBucketId(bucket.id);

    try {
      const response = await fetch(`/api/buckets/${bucket.id}`, {
        method: "DELETE",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to delete bucket.");
      }

      const payload = (await response.json()) as {
        buckets: BucketSetting[];
      };

      clearLocalDashboardState();
      setArmedDragBucketId(null);
      setDraggingBucketId(null);
      setDropTargetBucketId(null);
      syncBuckets(payload.buckets);
      toast.success(`Deleted ${bucket.name}.`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to delete bucket.",
      );
    } finally {
      setDeletingBucketId(null);
    }
  }

  async function handleResetDefaults() {
    if (
      isResettingDefaults ||
      deletingBucketId ||
      isCreatingBucket ||
      savingBucketId ||
      isReorderingBuckets ||
      isInvalidatingCache
    ) {
      return;
    }

    setIsResettingDefaults(true);

    try {
      const response = await fetch("/api/buckets/reset", {
        method: "POST",
      });

      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | {
              error?: string;
            }
          | null;

        throw new Error(payload?.error ?? "Unable to reset default buckets.");
      }

      const payload = (await response.json()) as {
        buckets: BucketSetting[];
      };

      clearLocalDashboardState();
      setArmedDragBucketId(null);
      setDraggingBucketId(null);
      setDropTargetBucketId(null);
      syncBuckets(payload.buckets);
      toast.success("Restored the stock bucket set.");
    } catch (error) {
      toast.error(
        error instanceof Error
          ? error.message
          : "Unable to reset default buckets.",
      );
    } finally {
      setIsResettingDefaults(false);
    }
  }

  return (
    <section className="rounded-[2rem] border border-white/70 bg-white/88 p-6 shadow-[0_30px_80px_rgba(15,23,42,0.12)] backdrop-blur md:p-8">
      <div className="space-y-6">
        <div className="space-y-3">
          <div className="max-w-3xl">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-slate-500">
              Buckets
            </p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight text-slate-950">
              Classification prompts
            </h2>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-3xl text-sm leading-6 text-slate-600">
              Shape the taxonomy however you want. Add, rewrite, reorder, delete,
              and, if needed, restore the stock bucket set as a starting point.
            </p>
            <button
              aria-label="Reset buckets to defaults"
              className="inline-flex shrink-0 items-center justify-center gap-2 self-start rounded-full border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:text-slate-400 sm:self-center"
              disabled={
                isResettingDefaults ||
                Boolean(deletingBucketId) ||
                isCreatingBucket ||
                Boolean(savingBucketId) ||
                isReorderingBuckets ||
                isInvalidatingCache
              }
              onClick={() => void handleResetDefaults()}
              title="Reset to defaults"
              type="button"
            >
              <RotateCcw
                aria-hidden="true"
                className={isResettingDefaults ? "h-4 w-4 animate-spin" : "h-4 w-4"}
                strokeWidth={2}
              />
              <span>{isResettingDefaults ? "Resetting..." : "Reset to defaults"}</span>
            </button>
          </div>
        </div>

        <section className="rounded-[1.5rem] border border-slate-200 bg-[linear-gradient(180deg,rgba(249,250,251,0.96),rgba(244,247,250,0.92))] p-5">
          <div className="flex flex-col gap-4">
            <div className="grid items-start gap-3 md:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_auto]">
              <input
                className="rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-slate-400"
                maxLength={40}
                onChange={(event) => setNewBucketName(event.target.value)}
                placeholder="New bucket name"
                value={newBucketName}
              />
              <AutoResizeTextarea
                className="min-h-[3rem] max-h-40 resize-none overflow-hidden rounded-[1rem] border border-slate-200 bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400"
                onChange={(event) => setNewBucketPrompt(event.target.value)}
                placeholder="Prompt for this bucket"
                rows={1}
                value={newBucketPrompt}
              />
              <button
                className="inline-flex items-center justify-center gap-2 rounded-[1rem] bg-slate-950 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:bg-slate-400"
                disabled={
                  !newBucketName.trim() ||
                  isCreatingBucket ||
                  isResettingDefaults ||
                  Boolean(deletingBucketId)
                }
                onClick={() => void handleCreateBucket()}
                type="button"
              >
                <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                {isCreatingBucket ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </section>

        <div className="grid gap-3 md:grid-cols-2 md:items-start">
          {buckets.map((bucket) => {
            const draftPrompt = draftPrompts[bucket.id] ?? "";
            const isSaving = savingBucketId === bucket.id;
            const isDirty = draftPrompt !== bucket.prompt;
            const isDragging = draggingBucketId === bucket.id;
            const isDropTarget =
              dropTargetBucketId === bucket.id && draggingBucketId !== bucket.id;

            return (
              <article
                key={bucket.id}
                className={`rounded-[1.25rem] border bg-white p-4 transition ${
                  isDropTarget
                    ? "border-slate-400 shadow-[0_20px_45px_rgba(15,23,42,0.12)]"
                    : "border-slate-200"
                } ${isDragging ? "opacity-55" : ""} select-none`}
                draggable={
                  !isReorderingBuckets &&
                  !isResettingDefaults &&
                  !deletingBucketId &&
                  armedDragBucketId === bucket.id
                }
                onDragEnd={handleDragEnd}
                onDragOver={(event) => handleDragOver(event, bucket.id)}
                onPointerCancelCapture={() => setArmedDragBucketId(null)}
                onPointerDownCapture={(event) =>
                  handleCardPointerDown(event, bucket.id)
                }
                onPointerUpCapture={() => setArmedDragBucketId(null)}
                onDragStart={(event) => handleCardDragStart(event, bucket.id)}
                onDrop={(event) => void handleDrop(event, bucket.id)}
              >
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        aria-hidden="true"
                        className={`inline-flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-500 transition ${
                          isDragging ? "cursor-grabbing" : "cursor-grab"
                        }`}
                        data-drag-handle="true"
                      >
                        <GripVertical aria-hidden="true" className="h-4 w-4" />
                      </span>
                      <h3 className="text-base font-semibold text-slate-950">
                        {bucket.name}
                      </h3>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      Prompt used by the classifier for this bucket.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <button
                          aria-label={
                            deletingBucketId === bucket.id
                              ? `Deleting ${bucket.name}`
                              : `Delete ${bucket.name}`
                          }
                          className="flex h-10 w-10 items-center justify-center rounded-full border border-rose-200 bg-rose-50 text-rose-700 transition hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-50"
                          data-drag-exempt="true"
                          disabled={
                            Boolean(deletingBucketId) ||
                            isReorderingBuckets ||
                            isResettingDefaults ||
                            isCreatingBucket ||
                            Boolean(savingBucketId) ||
                            isInvalidatingCache
                          }
                          type="button"
                        >
                          <Trash2
                            aria-hidden="true"
                            className="h-4 w-4"
                            strokeWidth={2}
                          />
                        </button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {bucket.name}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the bucket. Cached thread snapshots stay
                            available, and the next inbox load only needs to
                            recompute memberships against your remaining buckets.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel disabled={deletingBucketId === bucket.id}>
                            Cancel
                          </AlertDialogCancel>
                          <AlertDialogAction
                            disabled={deletingBucketId === bucket.id}
                            onClick={() => void handleDeleteBucket(bucket)}
                          >
                            Delete bucket
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <button
                      className="inline-flex items-center justify-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-400"
                      data-drag-exempt="true"
                      disabled={
                        !isDirty ||
                        isSaving ||
                        isReorderingBuckets ||
                        isResettingDefaults ||
                        Boolean(deletingBucketId)
                      }
                      onClick={() => void handleSavePrompt(bucket.id)}
                      type="button"
                    >
                      <Save aria-hidden="true" className="h-4 w-4" strokeWidth={2} />
                      {isSaving ? "Saving..." : "Save"}
                    </button>
                  </div>
                </div>

                <AutoResizeTextarea
                  className="mt-4 min-h-[4.5rem] w-full resize-none overflow-hidden rounded-[1rem] border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-900 outline-none transition focus:border-slate-400 select-text"
                  data-drag-exempt="true"
                  draggable={false}
                  onChange={(event) =>
                    setDraftPrompts((current) => ({
                      ...current,
                      [bucket.id]: event.target.value,
                    }))
                  }
                  onDragStart={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                  }}
                  onPointerDown={(event) => {
                    event.stopPropagation();
                  }}
                  rows={2}
                  value={draftPrompt}
                />
              </article>
            );
          })}
        </div>

        {showDebugCacheControls ? (
          <section className="rounded-[1.5rem] border border-rose-200 bg-[linear-gradient(180deg,rgba(255,251,251,0.98),rgba(255,245,245,0.94))] p-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-2xl">
                <p className="text-sm font-semibold uppercase tracking-[0.24em] text-rose-500">
                  Debug
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-950">
                  Invalidate inbox cache
                </h3>
                <p className="mt-1 text-sm leading-6 text-slate-600">
                  Clears the entire cached bucketing result set for this user so
                  the next inbox load recomputes classifications from scratch.
                </p>
              </div>

              {hasInboxCache ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <button
                      className="inline-flex items-center justify-center rounded-full border border-rose-200 bg-rose-50 px-5 py-2.5 text-sm font-medium text-rose-700 transition hover:border-rose-300 hover:bg-rose-100"
                      type="button"
                    >
                      Invalidate cache
                    </button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Invalidate inbox cache?</AlertDialogTitle>
                      <AlertDialogDescription>
                        This deletes the full cached inbox classification state for
                        your account. The next inbox load will recompute all
                        bucketing work.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel disabled={isInvalidatingCache}>
                        Cancel
                      </AlertDialogCancel>
                      <AlertDialogAction
                        disabled={isInvalidatingCache}
                        onClick={() => void handleInvalidateCache()}
                      >
                        {isInvalidatingCache ? "Invalidating..." : "Invalidate cache"}
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <div
                  aria-describedby="empty-cache-tooltip"
                  className="group relative inline-flex"
                  tabIndex={0}
                >
                  <button
                    className="inline-flex items-center justify-center rounded-full border border-rose-100 bg-rose-50/60 px-5 py-2.5 text-sm font-medium text-rose-300"
                    disabled
                    type="button"
                  >
                    Invalidate cache
                  </button>
                  <div
                    className="pointer-events-none absolute bottom-[calc(100%+0.75rem)] left-1/2 z-10 hidden w-max max-w-52 -translate-x-1/2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-600 shadow-[0_20px_50px_rgba(15,23,42,0.14)] group-hover:block group-focus-within:block"
                    id="empty-cache-tooltip"
                    role="tooltip"
                  >
                    The cache is empty.
                  </div>
                </div>
              )}
            </div>
          </section>
        ) : null}
      </div>
    </section>
  );
}
