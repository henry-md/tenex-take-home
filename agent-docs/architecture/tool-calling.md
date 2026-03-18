# Tool Calling Architecture

## Goal

Keep the model constrained to a small, typed tool surface while all Google API access, approval decisions, and execution remain server-owned.

## Entry point

- `app/api/chat/route.ts`
  - Validates the session and Google access token.
  - Accepts chat messages from the client.
  - Calls `runGoogleWorkspaceAssistant(...)`.
  - Returns JSON with:
    - `content`
    - `toolCalls`

## Assistant loop

- `lib/assistant/google-workspace-agent.ts`
  - Defines the model-visible tool schema.
  - Builds the system prompt and tool-choice hinting.
  - Calls the OpenAI Responses API.
  - Executes returned tool calls on the server.
  - Sends `function_call_output` messages back into the Responses API until the model returns final text or the step limit is hit.

The current loop shape is:

1. Send system prompt plus chat history.
2. Let the model choose from app-owned tools only.
3. Parse each tool call's JSON arguments.
4. Route the call to server code in Gmail, Calendar, or draft modules.
5. Serialize tool results back to the model as `function_call_output`.
6. Repeat until there are no more tool calls.
7. Return final assistant text plus a summary of executed tool calls to the client.

## Tool families

- Gmail reads
  - `search_email_threads`
  - `get_email_thread`
  - `list_email_labels`
- Gmail writes
  - `prepare_email_action`
- Calendar reads
  - `search_calendar_events`
  - `get_calendar_event`
- Calendar writes
  - `prepare_calendar_action`
- Queue inspection
  - `list_pending_google_actions`

All mutations must stay behind `prepare_*` tools. Do not expose raw Google endpoint wrappers directly to the model.

## Gmail mutation structure

`prepare_email_action` is the model-visible Gmail write tool.

- It accepts one action plus one or more Gmail thread ids.
- A multi-email user request should be represented as one tool call with `threadIds`.
- The server normalizes `threadId` and `threadIds` into one target set before approval or execution.

This is important because bulk-email approval is based on how many emails the user request affects, not on how many tool calls the model happened to emit.

## Approval enforcement

Approval is not delegated to the model.

- The model can only ask to prepare a mutation.
- Server code decides whether that prepared mutation:
  - becomes a pending draft, or
  - executes immediately.

For Gmail bulk approval:

- If one prepared Gmail action targets more than one email, `BULK_EMAIL_ONLY` queues it.
- If the model incorrectly emits multiple Gmail prepare calls in one response step and those calls affect more than one email total, the server forces them into approval as a fallback.

## Draft and execution boundary

- Gmail and Calendar prepare functions create `IntegrationActionDraft` rows first.
- When approval is required, the draft remains `PENDING` until the user approves or rejects it.
- When approval is not required, the server still writes the draft for auditability and then executes it immediately.
- Approval routes execute the stored payload, not a fresh model instruction.

## UI integration

- The chat UI renders `content` as the assistant message.
- The UI may also render `toolCalls` for debugging or transparency.
- The approval queue reads pending drafts from `/api/action-drafts`.
- Queue cards should stay minimal and user-facing. Do not expose server-only implementation details there.

## Extension rules

- Add new Gmail write capabilities by extending `prepare_email_action` when the approval model stays the same.
- Add new Calendar write capabilities by extending `prepare_calendar_action` when the workflow stays in the same family.
- Split into a new tool only when the intent, validation, or approval semantics materially differ.
- Keep server-owned approval checks even if the prompt strongly instructs the model to behave correctly.
