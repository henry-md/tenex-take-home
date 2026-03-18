# Chat Email Rendering

## Goal

Let the assistant show Gmail results in chat without forcing the model to hand-format email content in prose.

## Rendering contract

- Gmail read tools return compact thread summaries from the server.
- The assistant may optionally call `set_chat_response_mode` after Gmail reads.
- `set_chat_response_mode` is the only model-visible signal that the UI should render structured email cards for the current assistant reply.
- When the assistant does not call `set_chat_response_mode` with `showEmailResults: true`, the UI must not render email cards even if Gmail read tools were used.
- When `showEmailResults` is enabled, email metadata becomes UI-owned. The backend must normalize the assistant text down to a short framing sentence if the model tries to restate subjects, senders, dates, snippets, or bodies in prose.

## What the UI shows

When `showEmailResults` is enabled for an assistant message, chat renders one collapsible card per email with:

- Subject in the card header
- Sender
- Formatted date and time
- Message snippet/preview in the expanded body
- Full message body text when available, with UI-owned truncation/expansion

Cards are collapsed under the subject row by default and expand inline on click.

## Persistence shape

Structured email presentation is persisted on `OpenAIChatMessage`, not inferred only from assistant prose:

- `content`
- `emailDisplay`
  - `show`
  - `maxCount`
- `emailResults`
  - `threadId`
  - `subject`
  - `sender`
  - `lastMessageAt`
  - `snippet`
  - `body`
- `toolCalls`

This allows the same assistant message to render the same email cards after refresh or later reloads.

## Prompting rule

The system prompt must tell the assistant:

- The UI can render structured email cards from Gmail read results.
- Do not restate subject, sender, timestamp, snippet, or body in prose when cards will be shown.
- Use `set_chat_response_mode` only when the user wants emails displayed in chat, such as "show my last 3 emails" or "read me the latest message."
- When email cards are shown, keep the assistant text to a single short framing sentence instead of a textual list.
- If Gmail data is only supporting context for another answer, keep the response textual and do not enable email card rendering.

## Why this boundary matters

- UI formatting stays deterministic and app-owned.
- The model decides whether showing emails is useful for the current reply.
- The model does not waste tokens reproducing data that the UI already has.
- Refreshes preserve both the assistant narration and the rendered email objects.
