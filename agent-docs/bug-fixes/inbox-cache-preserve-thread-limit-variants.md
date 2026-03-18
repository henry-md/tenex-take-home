# Inbox Cache Preserve Thread-Limit Variants

## Symptom

Switching the inbox thread limit from `200` to `20` caused the previously built `200`-thread cache to disappear, so switching back to `200` recomputed from scratch instead of reusing the existing snapshot.

## Cause

Both cache layers treated inbox state as a single slot:

- client local storage overwrote or cleared the only cached inbox entry when the configured limit changed
- server persistence saved all inbox state under one fixed cache key per owner, so a `20`-thread refresh replaced the `200`-thread snapshot

## Fix

Store inbox caches per configured thread limit on both client and server:

- local storage now keeps a map of cached inbox snapshots keyed by thread limit
- persisted inbox classification rows now use a thread-limit-specific cache key, while still reading the legacy single-key row as a fallback
