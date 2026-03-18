## Chat metadata client drift

- Symptom: chat history appeared to clear itself after each message, with Prisma throwing `Unknown field \`emailDisplay\`` or `Unknown field \`emailResults\`` on `OpenAIChatMessage`.
- Cause: chat persistence started selecting new JSON metadata fields while some environments still behaved like a legacy Prisma client/runtime that only knew about the original chat columns.
- Fix: make chat reads and writes fall back to the legacy field set when those metadata fields are rejected, and never delete saved chat history just because a read failed.
