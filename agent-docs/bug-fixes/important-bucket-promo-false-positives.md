# Important bucket promotional false positives

- Symptom: the Important bucket over-classified promotional emails that used urgency-heavy copy, including app marketing mail that encouraged the user to place bets.
- Cause: the default Important prompt was too broad, and the classifier instructions did not explicitly tell the model to treat sender identity as a first-class signal.
- Fix: tighten the Important bucket prompt, pass the parsed sender address explicitly alongside sender/domain metadata, instruct the classifier to discount urgency language from promotional, automated, or bulk senders, and explicitly frame Important as a selective top-5-10%-of-inbox bucket rather than a catch-all for useful mail.
