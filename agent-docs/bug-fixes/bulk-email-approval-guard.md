# Bulk Email Approval Guard

## Bug

Bulk-email approval was evaluated with `affectedEmailCount: 1` for every Gmail draft, even when the user asked to modify multiple emails. The model-visible Gmail mutation tool also only accepted a single `threadId`, which encouraged multi-email requests to be split into separate single-email tool calls.

## Fix

- Allow `prepare_email_action` to carry multiple Gmail thread ids for one action.
- Compute approval from the actual number of targeted emails.
- Store and execute one draft across all targeted threads.
- Add a server-side fallback that forces approval when the model emits multiple Gmail prepare calls in the same response step and they affect more than one email in total.

## Guardrail

Any Gmail user request that affects more than one email should either:

- be represented as one prepared Gmail action with multiple thread ids, or
- be forced into approval before execution if the model split it into multiple Gmail prepare calls in the same step.
