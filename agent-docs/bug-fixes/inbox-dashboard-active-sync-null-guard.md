# Inbox Dashboard Active Sync Null Guard

## Symptom

Railway builds failed on commit `a8a1939` during `pnpm run build` with:

- `Type error: 'activeSyncIndicator' is possibly 'null'.`

The failure pointed at the active sync progress UI in `app/components/inbox-dashboard.tsx`.

## Cause

The component only rendered that block when `activeSyncLabel` was truthy, but TypeScript could not infer from `activeSyncLabel` that `activeSyncIndicator` itself was non-null. Accessing `activeSyncIndicator.kind` directly inside that branch still failed production type-checking.

## Fix

- Compute the boolean from the nullable value directly, for example `const isSyncingNewEmail = activeSyncIndicator?.kind === "new-email";`
- Render against that derived boolean instead of dereferencing `activeSyncIndicator.kind` inside JSX.
- Always run `pnpm run build` before considering a task complete, because this failure was easy to miss without the production build check.
