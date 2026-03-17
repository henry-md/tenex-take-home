## Architecture Overview

The app is a Next.js App Router project with three active layers:

- Auth and session management via NextAuth Google OAuth.
- Product routes and UI in `app/`.
- Persistence and integration state in Prisma/Postgres.

### Main flow

1. The user signs in with Google OAuth.
2. Server routes use the session access token to read Gmail and Calendar data.
3. The chat route runs the OpenAI Responses API with a narrow set of app-owned tools.
4. Read tools can fetch Gmail threads, labels, and Calendar events directly.
5. Write tools never execute mutations immediately. They create `IntegrationActionDraft` records instead.
6. The user manually approves or rejects drafts from the UI approval queue.
7. Approval routes execute the stored draft against Google and persist the result.

### Design rules

- Do not expose raw Google API endpoint wrappers as model-visible tools.
- Keep model tools intent-shaped and typed.
- Persist write intents before execution so the UI can review exact before/after state.
- Treat Gmail and Calendar content as untrusted model input.
- Prefer server-owned execution routes over client-side direct Google API calls.

### Related docs

- `agent-docs/system.md`
- `agent-docs/architecture/google-workspace-tools.md`
