---
name: review
description: Load for a review, audit or critique of code, design, instructions or a PR body.
---

# Review

Review immutable base/head pairs against the accepted requirements, repository contracts and canonical examples. Trace changed contracts through their real consumers and relevant failure, concurrency, resource-lifetime and previous-release data paths. Judge ownership and architecture, not just individual lines.

One complete pass reports every defect class. Later rounds cover fixes and the contracts they touch. Stay read-only: probe public interfaces, but do not change code, run suites, start services or drive the shared browser. Name missing proof.

## Findings

Each finding names severity, `path:line`, a reachable input, the violated contract, evidence and the smallest fix. Report every instance of a class once. Taste without a rule, hypothetical callers and diagnostics already covered by lint are not findings. Separate pre-existing defects from defects the change introduces or relies on.

| Severity | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| P1       | Broken user/caller contract, data loss, secret exposure, missing migration or false claim   |
| P2       | Repository ownership, boundary or reference violation; unnecessary, duplicated or dead code |
| P3       | Naming, wording or style                                                                    |

Check behavior and claims against their evidence, not the author's summary. Read the PR body and captures as a reader without the chat, using its template. Say the covered scope when no P1 or P2 remains.

For UI changes, verify responsive input, retained valid content, loading confined to the affected region and requests limited to the interaction's needs.

For instructions, read the affected system as a whole: find contradictions, duplicated facts, misplaced rules and constraints whose original cause no longer exists. Prefer the smallest correction that complements the model.
