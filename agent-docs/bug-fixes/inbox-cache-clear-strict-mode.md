# Inbox Cache Clear Strict Mode Replay

## Symptom

After clearing the inbox classification cache in Settings, the next dashboard load could still report `cache hit`.

## Cause

`InboxDashboard` loaded `/api/inbox` from a mount `useEffect`. In development, React Strict Mode replays that effect once, so the first request rebuilt the cache and the second request immediately reused it. The surviving toast made cache invalidation look broken even though the delete succeeded.

## Fix

Guard the initial dashboard inbox load so it only runs once per real mount lifecycle, which keeps the first post-invalidation load as a true cache miss.
