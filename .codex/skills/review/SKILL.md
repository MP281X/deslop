---
name: review
description: Load for a review, audit or critique of code, design, instructions or a PR body.
---

# Review

Review immutable base/head pairs against the accepted requirements, repository contracts and canonical examples. Trace changed contracts through their real consumers and the relevant failure, concurrency, resource-lifetime and previous-release data paths. Judge ownership and architecture, not just lines.

One complete pass reports every defect class; later rounds cover the fixes and the contracts they touch. Make no edits. Run tests, probes and services as evidence needs, and use your own preview tab (`preview_open` with `reuseExistingTab: false`). Name missing proof.

## Findings

Each finding names severity, `path:line`, a reachable input, the violated contract, evidence and the smallest fix. Report every instance of a class once. Taste without a rule, hypothetical callers and diagnostics lint already covers are not findings. Keep pre-existing defects apart from those the change introduces or relies on.

| Severity | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| P1       | Broken user/caller contract, data loss, secret exposure, missing migration or false claim   |
| P2       | Repository ownership, boundary or reference violation; unnecessary, duplicated or dead code |
| P3       | Naming, wording or style                                                                    |

Check behavior and claims against their evidence, not the author's summary. Read the PR body and its captures as a reader without the chat, against its template. Say the covered scope when no P1 or P2 remains.

For UI changes, verify responsive input, retained valid content, loading confined to the affected region and requests limited to the interaction's needs.

For instructions, read the affected system as a whole: find contradictions, duplicated facts, misplaced rules, restatements of what the harness or tools already say, and constraints whose cause is gone. Prefer the smallest correction that complements the model.
