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

- Bucket management now lives in Settings through `GET/POST /api/buckets` and `PATCH /api/buckets/[bucketId]`.
- Each bucket stores an editable classifier prompt in the bucket `description` field.
- Default buckets ship with starter prompts that guide the LLM toward the intended category semantics.
- Custom buckets are first-class options in the LLM prompt, not post-processing filters.

## UI boundary

- The inbox dashboard is the primary authenticated experience.
- The assistant chat remains available, but as a collapsed lower-right dock by default.
- The triage-board hero can be dismissed per browser via local storage.
- Users do not open full email threads from the dashboard.
