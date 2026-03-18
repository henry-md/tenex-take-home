# Inbox Bucketing

## Goal

Make the authenticated homepage inbox-first by loading the latest configured Gmail inbox thread set and grouping it into triage buckets before the user interacts with chat.

## Main flow

1. `GET /api/inbox` authenticates the Google session and loads the owner identity.
2. `lib/inbox/classification.ts` ensures the owner's default bucket taxonomy exists in Prisma.
3. The server fetches the latest inbox threads via `listRecentInboxThreads`, using the owner's saved limit or `DEFAULT_INBOX_THREAD_LIMIT`.
4. Deterministic heuristics classify obvious newsletters, finance mail, auto-archive candidates, important threads, and personal mail first.
5. Remaining threads are sent to the OpenAI Responses API in batches with a compact structured payload.
6. Low-confidence or failed LLM classifications fall back to `Can wait`.
7. Before classification runs, the server computes a human-readable cache key from the active thread limit, latest thread fingerprint, and bucket prompt configuration.
8. When that cache key matches a persisted inbox cache row, the app reuses the stored grouped results instead of reclassifying.
9. The client renders grouped thread summaries only: subject, sender, preview, and timestamp.

## Custom buckets

- Bucket management now lives in Settings through `GET/POST/PATCH /api/buckets` and `PATCH /api/buckets/[bucketId]`.
- Each bucket stores an editable classifier prompt in the bucket `description` field.
- Settings bucket order is persisted via the bucket `sortOrder` field so drag reordering survives refreshes.
- Default buckets ship with starter prompts that guide the LLM toward the intended category semantics.
- Custom buckets are first-class options in the LLM prompt, not post-processing filters.

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
- Gmail fetch time covers `listRecentInboxThreads`, including listing inbox thread ids and fetching thread summaries from Gmail.
- Sorting time starts after Gmail data is loaded and includes cache lookup, heuristic classification, optional LLM classification, fallback assignment, and cache write.
- `GET /api/inbox` returns both timings so the dashboard can show two success toasts: one for Gmail fetch and one for sorting.
- A cache hit only skips reclassification work. Gmail fetch still runs first because the cache key depends on the current inbox snapshot.
