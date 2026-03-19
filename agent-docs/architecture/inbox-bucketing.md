# Inbox Bucketing

## Goal

Make the authenticated homepage inbox-first by loading the latest configured Gmail inbox thread set and grouping it into triage buckets before the user interacts with chat.

## Main flow

1. `GET /api/inbox` authenticates the Google session and loads the owner identity.
2. `lib/inbox/classification.ts` loads the owner's current bucket taxonomy from Prisma.
3. The server reuses normalized inbox cache rows from `InboxClassificationCache` instead of a single limit-keyed board snapshot.
4. The cache is split into an ordered head manifest, per-thread snapshots, and per-thread/per-bucket membership rows.
5. Default dashboard load builds the board from the cached manifest prefix and cached rows without hitting Gmail when there is reusable cached state.
6. If the configured thread limit grows beyond the cached manifest length, the default load can still return the stale cached prefix immediately and let background sync fill the missing tail.
7. Refresh loads first list the latest top-window Gmail thread ids, then fetch only newly introduced or otherwise uncached threads for common prepend/backfill changes.
8. Mixed reorder changes fall back to fetching the full current top window.
9. Deterministic heuristics classify obvious newsletters, finance mail, auto-archive candidates, important threads, and personal mail first, but those heuristic matches are additive rather than exclusive.
10. The OpenAI Responses API returns a list of bucket names for each thread, so one thread can appear in multiple buckets.
11. When bucket prompts change, only stale bucket memberships are recomputed from cached thread snapshots.
12. The client renders grouped thread rows by bucket. Collapsed rows show subject, sender, preview, and timestamp; expanding a row may reveal the cached plain-text body of the latest message inline. Because bucket membership is many-to-many, the same thread can appear in multiple bucket groups.

## Custom buckets

- Bucket management now lives in Settings through `GET/POST/PATCH /api/buckets`, `POST /api/buckets/reset`, and `PATCH/DELETE /api/buckets/[bucketId]`.
- Each bucket stores an editable classifier prompt in the bucket `description` field.
- Settings bucket order is persisted via the bucket `sortOrder` field so drag reordering survives refreshes.
- The stock bucket set ships with starter prompts that guide the LLM toward the intended category semantics.
- Custom buckets are first-class options in the LLM prompt, not post-processing filters.
- Adding or editing one bucket no longer forces the server to re-fetch Gmail or reclassify every bucket for every cached thread.
- Deleting a bucket or resetting defaults keeps cached thread snapshots available so the next inbox load can recompute memberships without re-reading Gmail threads.
- Stock buckets are no longer auto-recreated on read. They come back only when the user explicitly resets the bucket set.

## UI boundary

- The inbox dashboard is the primary authenticated experience.
- The assistant chat remains available, but as a collapsed lower-right dock by default.
- The triage-board hero can be dismissed per browser via local storage.
- Users do not navigate into a separate full-thread reading screen from the dashboard.
- After the initial inbox sort, the dashboard passively polls for newer inbox activity and shows a manual refresh prompt with the count of currently unsorted inbox items. It never auto-refreshes the board.

## Route transition behavior

- The app uses Next.js App Router route transitions, not a single long-lived client-only SPA screen.
- `app/loading.tsx` and `app/settings/loading.tsx` provide route-level skeletons so switching between `/` and `/settings` paints immediately even while the destination route is still waiting on server work.
- This change improves perceived tab-switch latency only. It does not remove the underlying inbox load cost when the dashboard remounts.

## Inbox timing instrumentation

- `loadInboxHomepage` records Gmail fetch time separately from inbox sorting time.
- Gmail fetch time covers refresh loads only. Cached dashboard loads can legitimately report `0ms` Gmail fetch time because they reuse the stored manifest, snapshots, and memberships.
- Refresh loads first list inbox thread ids from Gmail, then fetch only the missing or mixed-change thread summaries needed to converge the cache.
- Sorting time includes cache lookup, selective reclassification for changed threads or stale bucket memberships, and cache write.
- `GET /api/inbox` returns both timings plus separate Gmail-cache-hit and sorting-cache-hit flags so the dashboard can show two success toasts: one for Gmail/thread reuse and one for sorting reuse.
- A cache hit on the default dashboard load can avoid Gmail entirely, even when that cached load is only a partial prefix for a newly increased thread limit.

## Related cache doc

- `agent-docs/architecture/inbox-cache.md`
