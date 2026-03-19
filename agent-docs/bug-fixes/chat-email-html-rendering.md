# Chat email HTML rendering

- Symptom: some chat email cards displayed raw HTML boilerplate, CSS, and Outlook/MSO comment blocks as visible text instead of rendering the email body.
- Cause: the chat UI passed full email HTML through a markdown renderer, which is not a reliable renderer for complete HTML email documents.
- Fix: sanitize the HTML string directly, strip head/style/script/comment noise first, and render the sanitized HTML in the chat email body. Keep the plain-text body as a fallback when sanitized HTML is empty.
