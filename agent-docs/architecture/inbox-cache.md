# Inbox Cache

## Goal

Keep inbox bucketing reusable across two independent change types:

- new or reordered inbox threads
- added or edited bucket prompts

## Stored shape

Inbox cache lives as owner-scoped `InboxClassificationCache` rows keyed by thread limit. Each payload stores reusable classification state instead of a pre-rendered board blob:

- `threadIds`
  - ordered Gmail thread ids for the current inbox snapshot and configured limit
- `threadsById`
  - normalized cached thread snapshots keyed by Gmail thread id
  - includes subject, sender, preview, body, labels, timestamp, and a fingerprint hash
- `bucketMembershipsByThreadId`
  - per-thread, per-bucket cached membership decisions
  - each entry stores `applies`, `confidence`, `rationale`, `source`, the thread fingerprint used at evaluation time, and the bucket prompt hash used at evaluation time

At read time, the runtime treats cached thread snapshots and cached bucket memberships independently:

- a smaller thread limit can reuse the freshest cached payload whose thread limit is greater than or equal to the requested limit by slicing the ordered `threadIds`
- bucket deletions and default-bucket resets keep cached thread snapshots available, so the next inbox load only recomputes memberships

## Runtime behavior

`GET /api/inbox` has two modes:

- default load
  - uses the freshest compatible cached `threadIds`, cached thread snapshots, and cached bucket memberships
  - does not hit Gmail when a cached snapshot already covers the current configured inbox limit
  - if bucket prompts changed, or the active bucket set changed, only stale bucket memberships are recomputed from cached thread snapshots
- refresh load
  - triggered with `?refresh=1`
  - fetches the latest inbox thread ids from Gmail, then fetches summaries for the current top thread set
  - only threads whose fingerprints changed are reclassified across all buckets
  - unchanged threads reuse their cached bucket memberships

## Incremental classification rules

- New or changed thread:
  - reclassify that thread against all active buckets
- New or edited bucket:
  - re-evaluate only that bucket against cached thread snapshots
- Unchanged thread plus unchanged bucket prompt:
  - reuse the cached membership result directly

This is why a bucket edit no longer forces a full inbox re-sort.
This is also why shrinking the inbox thread limit can now be a cache hit with no Gmail read.

## Refresh status

`GET /api/inbox-status` now checks only the ordered inbox thread ids from Gmail. It compares those ids against the freshest compatible cached `threadIds` and reports how many positions are currently unsorted relative to the cached board. It does not fetch full thread bodies or rerun classification.

## UI contract

- Initial dashboard load prefers cached inbox state.
- If the dashboard rendered from cached inbox state, the client immediately starts a background Gmail check and shows a non-blocking status pill while it is checking or fetching newer inbox threads.
- Manual refresh first checks `/api/inbox-status`.
- If there are no new or reordered inbox threads, the dashboard keeps the cached board.
- If there are updates, the dashboard calls `/api/inbox?refresh=1` to sync Gmail and incrementally recompute memberships.
- The existing inbox-status polling loop still runs after load, so the UI can continue to alert the user when newer inbox activity arrives after the cached board was rendered.
