# Inbox Concierge System Brief

## Product Goal
Inbox Concierge helps a user connect a Google Workspace (G-Suite) account, read the user's Gmail inbox metadata, and organize recent email threads into actionable buckets. The product behaves like a triage-focused inbox homepage, not a full email client.

## Core User Flow
1. On first visit, prompt the user to authenticate with Google using OAuth and request Gmail read access sufficient to list threads and message snippets.
2. After authentication, fetch the user's configured recent Gmail thread count. New users default to `DEFAULT_INBOX_THREAD_LIMIT`.
3. Run that thread set through an LLM-powered classification pipeline that assigns each thread to one or more buckets.
4. Render a homepage-style inbox view grouped by bucket. Each listed item only needs:
   - Subject line
   - Short preview/snippet
   - Bucket assignment
5. The user does not need the ability to open or read the full email thread in-app.
6. The user can create additional custom buckets at any time.
7. When a custom bucket is added, re-run categorization across the same loaded thread set so every thread is reconsidered against the updated bucket taxonomy.

## Default Buckets
The initial product should support a small default set of buckets that cover common inbox triage patterns:
- Important
- Can wait
- Auto-archive
- Newsletter
- Finance
- Personal

These defaults should be editable in the future, but agents should treat them as the starting taxonomy unless product requirements change.

## Classification Pipeline
Agents should design the inbox bucketing flow as an LLM-assisted pipeline instead of a single naive prompt.

Recommended pipeline:
1. Normalize each Gmail thread into a compact classification payload containing thread id, subject, snippet, sender metadata, timestamps, labels, and lightweight thread statistics.
2. Apply deterministic heuristics first for obvious cases before using the LLM:
   - Marketing/newsletter senders
   - Automated receipts or transactional updates
   - Low-priority bulk mail
   - Previously seen sender patterns
3. Send only the minimal structured payload needed into the LLM classifier.
4. Ask the model to choose one or more buckets from the active bucket list and return:
   - Selected buckets
   - Short rationale
   - Confidence score
5. Use a fallback or review rule for low-confidence classifications. For example, low-confidence items can default to `Can wait` unless a better product rule is introduced.
6. Store enough classification metadata so the system can explain or audit why a thread landed in a bucket.

## Custom Buckets
Users must be able to define their own buckets beyond the defaults.

Requirements for custom buckets:
- A custom bucket needs at least a user-provided name.
- After a new custom bucket is created, the system should recategorize all currently loaded threads using the updated full bucket list.
- Reclassification should treat custom buckets as first-class options, not post-processing filters layered on top of the defaults.
- If multiple buckets genuinely apply, the classifier should return all of them rather than force a single winner.

## UI Expectations
The main screen should look and feel similar to an email application's inbox landing page:
- Buckets are the primary grouping mechanism.
- Each thread row shows only summary information.
- No thread-detail view is required.
- Fast scanning matters more than dense functionality.

## Constraints
- Do not build compose, reply, or thread-reading experiences unless requirements expand.
- Gmail access is for inbox organization and summary presentation.
- The key product behavior is accurate, explainable bucketing and fast recategorization when the bucket taxonomy changes.
