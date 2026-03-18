# Inbox Sync Deletion Copy

## Symptom

After inbox deletions, the dashboard could say `Synced N new Gmail threads` even though no new mail arrived. The polling status also only counted newly introduced ids, so delete-only changes could be mislabeled or missed.

## Cause

The refresh flow tracked top-window changes as `newThreadCount` only. When deleted inbox threads were replaced by older backfill threads to preserve the configured recent-thread window, those replacement ids were incorrectly treated as new mail.

## Fix

Compute a fuller inbox sync change summary with added, removed, and changed counts. Use that summary to:

- trigger refreshes for any top-window change, not just newly introduced ids,
- show a generic `Syncing N inbox changes` progress label during polling,
- distinguish new-mail syncs from deletion-driven refreshes in the final Gmail toast copy,
- keep the refresh fetch anchored to the latest configured inbox thread limit.
