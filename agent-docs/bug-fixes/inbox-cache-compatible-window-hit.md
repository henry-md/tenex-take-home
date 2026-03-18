# Inbox Cache Compatible Window Hit

## Symptom

Shrinking the inbox thread limit, for example from `200` to `100`, still triggered a Gmail re-fetch and a full inbox re-sort even though the larger cached snapshot already contained the smaller window.

Bucket deletion and default-bucket reset also dropped the expensive cached Gmail thread snapshots, so the next inbox load had to read Gmail again before it could recompute memberships.

## Cause

- The server only reused cache rows whose thread limit exactly matched the current setting.
- The dashboard forced an initial refresh after every thread-limit change, which bypassed the cache-hit path.
- Bucket delete and reset flows deleted all inbox cache rows instead of preserving thread snapshots and only invalidating memberships logically.

## Fix

- Cache lookup now selects the freshest compatible inbox snapshot whose thread limit is greater than or equal to the requested limit, then slices it down when needed.
- The dashboard no longer forces a refresh just because the thread limit changed; it lets the server decide whether the new limit is already covered by cache.
- Bucket delete and reset preserve cached inbox payloads, so the next load can reuse Gmail thread snapshots and only recompute memberships for the active bucket set.
