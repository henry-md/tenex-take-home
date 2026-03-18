# Inbox Cache

## Goal

Keep inbox bucketing reusable across two independent change types:

- new or reordered inbox threads
- added or edited bucket prompts

## Stored shape

Inbox cache now lives as one active owner-scoped row in `InboxClassificationCache`. The payload stores reusable classification state instead of a pre-rendered board blob:

- `threadIds`
  - ordered Gmail thread ids for the current inbox snapshot and configured limit
- `threadsById`
  - normalized cached thread snapshots keyed by Gmail thread id
  - includes subject, sender, preview, body, labels, timestamp, and a fingerprint hash
- `bucketMembershipsByThreadId`
  - per-thread, per-bucket cached membership decisions
  - each entry stores `applies`, `confidence`, `rationale`, `source`, the thread fingerprint used at evaluation time, and the bucket prompt hash used at evaluation time

## Runtime behavior

`GET /api/inbox` has two modes:

- default load
  - uses cached `threadIds`, cached thread snapshots, and cached bucket memberships
  - does not hit Gmail when the stored snapshot already matches the current configured inbox limit
  - if bucket prompts changed, only stale bucket memberships are recomputed from cached thread snapshots
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

## Refresh status

`GET /api/inbox-status` now checks only the ordered inbox thread ids from Gmail. It compares those ids against cached `threadIds` and reports how many positions are currently unsorted relative to the cached board. It does not fetch full thread bodies or rerun classification.

## UI contract

- Initial dashboard load prefers cached inbox state.
- Manual refresh first checks `/api/inbox-status`.
- If there are no new or reordered inbox threads, the dashboard keeps the cached board.
- If there are updates, the dashboard calls `/api/inbox?refresh=1` to sync Gmail and incrementally recompute memberships.
