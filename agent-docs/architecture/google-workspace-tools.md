# Google Workspace Tools

## Goal

Support Gmail and Google Calendar actions in chat without exposing raw Google APIs directly to the model, while letting the user choose how much manual approval is required before mutations execute.

## Tool surface

Model-visible tools are grouped by user intent instead of by Google endpoint:

- Read tools
  - `search_email_threads`
  - `get_email_thread`
  - `list_email_labels`
  - `search_calendar_events`
  - `get_calendar_event`
- Mutation tools
  - `prepare_email_action`
  - `prepare_calendar_action`
- Queue inspection
  - `list_pending_google_actions`

This keeps the assistant surface small while still letting the backend call multiple Google endpoints internally when needed.

## Safety model

All Gmail and Calendar writes go through `prepare_*` tools. What happens next depends on the user's selected approval mode:

- `SAFE`
  - All Gmail and Calendar modifications are queued for approval.
- `BULK_EMAIL_ONLY`
  - Only actions that modify or delete more than one email are queued for approval.
  - Single-email actions and Calendar actions execute immediately.
- `DANGEROUS`
  - No modifications require approval.

When approval is required, the flow is:

1. The assistant calls a `prepare_*` tool.
2. The server validates the request and fetches current Google state.
3. The server stores an `IntegrationActionDraft` row with:
   - owner identity
   - provider and action kind
   - target id
   - before state
   - proposed after state
   - execution payload
   - expiration timestamp
4. The UI shows the draft in the approval queue.
5. Only an explicit user approval hits the execution route.
6. The execution route applies the stored payload to Google and records the result or failure.

When approval is not required, the server still creates an audit record and immediately executes it.

The assistant must never claim a mutation succeeded when the tool returned a pending draft. It may only confirm completion when the tool result status is `EXECUTED`.

## Current implementation notes

- Auth scopes include Gmail modify and Calendar events access.
- Access tokens are refreshed in the NextAuth JWT callback.
- Draft ownership is keyed by user email because the current app does not persist NextAuth users through an adapter.
- Approval mode is stored per user email in `WorkspaceApprovalPreference`.
- Calendar update and delete executions carry the event `etag` captured at draft time so stale drafts fail instead of overwriting newer changes.
- Drafts expire after 24 hours and are moved to `EXPIRED` when reloaded.

## Extension guidance

- Add new Gmail mutations by extending `prepare_email_action` with another typed action value, not by exposing a new raw endpoint tool.
- Add new Calendar mutations by extending `prepare_calendar_action` with new typed payload fields when the user-facing workflow stays in the same family.
- Split a tool family only when approval semantics or validation rules become materially different.
- Keep destructive or attendee-impacting operations behind the same manual approval queue even if the model requests them confidently.
