# Inbox thread expansion duplication

- Symptom: expanding a thread row in the inbox dashboard showed the same preview text twice, once truncated in the summary row and again in the expanded panel, which made the transition feel broken.
- Cause: the summary and expanded panel both rendered `thread.preview` with no open-state choreography, and the expanded panel started farther left than the subject block.
- Fix: keep the collapsed preview in the summary row only while closed. On open, animate that preview out, align the body panel under the same content column, join the two surfaces into one bordered card, and render the cached message body in the expanded state instead of repeating the preview.
