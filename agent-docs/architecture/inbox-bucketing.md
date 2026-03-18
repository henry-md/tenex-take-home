# Inbox Bucketing

## Goal

Make the authenticated homepage inbox-first by loading the latest configured Gmail inbox thread set and grouping it into triage buckets before the user interacts with chat.

## Main flow

1. `GET /api/inbox` authenticates the Google session and loads the owner identity.
2. `lib/inbox/classification.ts` loads the owner's current bucket taxonomy from Prisma.
3. The server stores one active inbox-state payload per owner in `InboxClassificationCache` instead of caching only a rendered board.
4. That payload keeps the ordered inbox thread ids, normalized cached thread snapshots, and per-thread/per-bucket membership decisions.
5. Deterministic heuristics classify obvious newsletters, finance mail, auto-archive candidates, important threads, and personal mail first, but those heuristic matches are additive rather than exclusive.
6. The OpenAI Responses API returns a list of bucket names for each thread, so one thread can appear in multiple buckets.
7. When Gmail refreshes, only changed thread snapshots are reclassified across all buckets.
8. When bucket prompts change, only stale bucket memberships are recomputed from cached thread snapshots.
9. The client renders grouped thread summaries only: subject, sender, preview, and timestamp. Because bucket membership is many-to-many, the same thread can appear in multiple bucket groups.

## Custom buckets

- Bucket management now lives in Settings through `GET/POST/PATCH /api/buckets`, `POST /api/buckets/reset`, and `PATCH/DELETE /api/buckets/[bucketId]`.
- Each bucket stores an editable classifier prompt in the bucket `description` field.
- Settings bucket order is persisted via the bucket `sortOrder` field so drag reordering survives refreshes.
- The stock bucket set ships with starter prompts that guide the LLM toward the intended category semantics.
- Custom buckets are first-class options in the LLM prompt, not post-processing filters.
- Adding or editing one bucket no longer forces the server to re-fetch Gmail or reclassify every bucket for every cached thread.
- Deleting any bucket clears the saved inbox classification cache so the next inbox load can recompute memberships against the remaining taxonomy.
- Stock buckets are no longer auto-recreated on read. They come back only when the user explicitly resets the bucket set.

## UI boundary

- The inbox dashboard is the primary authenticated experience.
- The assistant chat remains available, but as a collapsed lower-right dock by default.
- The triage-board hero can be dismissed per browser via local storage.
- Users do not open full email threads from the dashboard.
- After the initial inbox sort, the dashboard passively polls for newer inbox activity and shows a manual refresh prompt with the count of currently unsorted inbox items. It never auto-refreshes the board.

## Route transition behavior

- The app uses Next.js App Router route transitions, not a single long-lived client-only SPA screen.
- `app/loading.tsx` and `app/settings/loading.tsx` provide route-level skeletons so switching between `/` and `/settings` paints immediately even while the destination route is still waiting on server work.
- This change improves perceived tab-switch latency only. It does not remove the underlying inbox load cost when the dashboard remounts.

## Inbox timing instrumentation

- `loadInboxHomepage` records Gmail fetch time separately from inbox sorting time.
- Gmail fetch time covers inbox refresh loads only. Cached dashboard loads can legitimately report `0ms` Gmail fetch time because they reuse the stored inbox snapshot.
- Refresh loads first list inbox thread ids from Gmail, then fetch summaries only for the current top thread set.
- Sorting time includes cache lookup, selective reclassification for changed threads or stale bucket memberships, and cache write.
- `GET /api/inbox` returns both timings so the dashboard can show two success toasts: one for Gmail fetch and one for sorting.
- A cache hit on the default dashboard load can avoid Gmail entirely.

## Related cache doc

- `agent-docs/architecture/inbox-cache.md`
