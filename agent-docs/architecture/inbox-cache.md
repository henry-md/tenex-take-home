# Inbox Cache

## Goal

Keep inbox bucketing reusable across three independent change types:

- a different configured inbox thread limit
- new, deleted, or reordered inbox threads
- added or edited bucket prompts

## Stored shape

Inbox cache still lives in `InboxClassificationCache`, but it is now normalized instead of one blob per thread limit. Each owner gets three cache row types:

- head manifest
  - cache key: `inbox-state-v3:manifest`
  - stores the last synchronized ordered inbox `threadIds` for the current top-window fetch
- thread snapshot rows
  - cache key prefix: `inbox-state-v3:thread:`
  - one row per Gmail thread id
  - stores the normalized snapshot plus a fingerprint hash
- bucket membership rows
  - cache key prefix: `inbox-state-v3:membership:`
  - one row per `threadId + bucketId`
  - stores `applies`, `confidence`, `rationale`, `source`, `threadFingerprint`, and `bucketPromptHash`

The runtime treats order, thread content, and bucket decisions as separate reusable assets.

## Runtime behavior

`GET /api/inbox` has two modes:

- default load
  - reads the cached manifest first
  - loads cached thread snapshots and cached memberships for the manifest prefix up to the current configured limit
  - does not hit Gmail on the hot path when there is any renderable cached prefix
  - may return fewer than `configuredThreadLimit` threads if the user increased the limit and the cache only has a smaller synchronized prefix
  - recomputes only stale or missing bucket memberships from cached thread snapshots
- refresh load
  - triggered with `?refresh=1`
  - lists the latest top-window thread ids from Gmail
  - diffs those ids against the cached manifest
  - fetches only the Gmail threads that are newly introduced or missing from cache for simple prepend/backfill changes
  - falls back to fetching the full current window for mixed reorder changes
  - reclassifies only new or fingerprint-changed threads, then fills any stale memberships

This means `100 -> 101` can render the cached 100 immediately, then fetch and classify only the missing tail thread in the common case.

## Incremental classification rules

- New or fingerprint-changed thread:
  - reclassify that thread against all active buckets
- New or edited bucket:
  - re-evaluate only that bucket against cached thread snapshots
- Unchanged thread plus unchanged bucket prompt:
  - reuse the cached membership result directly

Bucket deletions and default-bucket resets preserve thread snapshots. The next inbox load only needs to rebuild memberships for the active bucket set.

## Refresh status

`GET /api/inbox-status` checks only the ordered inbox thread ids from Gmail. It compares those ids against the cached manifest prefix for the current configured limit and reports whether the top window changed. Reorder-only changes are treated as mixed updates even when the thread id set is unchanged.

## UI contract

- Initial dashboard load prefers cached inbox state.
- If the dashboard rendered from cached inbox state, the client immediately starts a background Gmail check and shows a non-blocking status pill while it checks or fetches newer inbox data.
- A cached dashboard response can be partial for a newly increased thread limit. The UI still renders that stale prefix immediately and lets the background refresh fill in the remainder.
- The inbox load response exposes Gmail/thread cache hits separately from sorting cache hits so the UI can report each reuse path explicitly.
- Manual refresh first checks `/api/inbox-status`.
- If there are no top-window changes, the dashboard keeps the cached board.
- If there are updates, the dashboard calls `/api/inbox?refresh=1` to sync Gmail and incrementally recompute memberships.
