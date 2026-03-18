# Inbox Refresh Toast Count

## Symptom

Background inbox sync could detect `1` new email in `/api/inbox-status`, show `Syncing 1 new email` in the status pill, and then finish with a toast that said `Fetched 100 Gmail threads`.

## Cause

`/api/inbox` populated the Gmail toast count from `inbox.totalThreads`, which is the full configured board size, not the incremental refresh delta.

## Fix

Track `newThreadCount` during Gmail synchronization, return it from `loadInboxHomepage`, and use that value in refresh toast copy. Initial uncached loads still report the full fetched thread count, while incremental refreshes now say `Synced N new Gmail threads`.
