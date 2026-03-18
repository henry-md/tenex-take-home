## Native email card duplication

- Symptom: when the assistant enabled native email rendering, the chat still showed a prose list of subjects, senders, and dates above the collapsible email cards.
- Cause: the system prompt asked the model not to restate email metadata, but the client still rendered arbitrary assistant prose alongside the native cards with no enforcement layer.
- Fix: treat `showEmailResults: true` as a native-email mode. Keep the prompt instruction, but also normalize the assistant text on the server to a short framing sentence unless it is already a brief non-duplicative intro.
- Follow-up: the expanded card body should not fall back to repeating the header preview. Preserve sanitized HTML alongside the plain-text body so the expanded state can render formatted email content and only show a fallback note when no additional body exists.
