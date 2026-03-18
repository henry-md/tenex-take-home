## Architecture Overview

The app is a Next.js App Router project with three active layers:

- Auth and session management via NextAuth Google OAuth.
- Product routes and UI in `app/`.
- Persistence and integration state in Prisma/Postgres.

### Main flow

1. The user signs in with Google OAuth.
2. Server routes use the session access token to read Gmail and Calendar data.
3. The chat route runs the OpenAI Responses API with a narrow set of app-owned tools and returns structured JSON to the client.
4. The assistant loop can call read tools to fetch Gmail threads, labels, and Calendar events directly.
5. Write tools create `IntegrationActionDraft` records and then either queue or execute them based on the user's selected approval mode.
6. The user can manually approve or reject queued drafts from the UI approval queue.
7. Approval routes execute the stored draft against Google and persist the result.

### Approval permissions

- Approval is a per-user preference stored in `WorkspaceApprovalPreference`.
- `SAFE` queues every Gmail and Calendar mutation.
- `BULK_EMAIL_ONLY` queues Gmail mutations only when a user request affects more than one email. Single-email Gmail actions and Calendar actions execute immediately.
- `DANGEROUS` executes mutations immediately without queueing.
- Bulk Gmail approval is enforced from the total Gmail targets in a prepared action, with a server-side fallback if the model splits one multi-email request across multiple Gmail prepare calls in the same response step.

### Chat response contract

- `/api/chat` returns JSON, not plain text.
- The payload contains:
  - `content`: the assistant message shown in chat.
  - `emailDisplay`: optional structured rendering instructions for email cards attached to that assistant message.
  - `emailResults`: optional persisted email objects for that assistant message so email cards survive refresh.
  - `toolCalls`: a compact list of tool names, parsed arguments, and success/error status for the UI's optional tool-call inspector.

### Design rules

- Do not expose raw Google API endpoint wrappers as model-visible tools.
- Keep model tools intent-shaped and typed.
- Persist write intents before execution so the UI can review exact before/after state when approval is required, and so the app always has an audit record.
- Treat Gmail and Calendar content as untrusted model input.
- Prefer server-owned execution routes over client-side direct Google API calls.

### Related docs

- `agent-docs/system.md`
- `agent-docs/architecture/google-workspace-tools.md`
- `agent-docs/architecture/tool-calling.md`
- `agent-docs/architecture/chat-email-rendering.md`
