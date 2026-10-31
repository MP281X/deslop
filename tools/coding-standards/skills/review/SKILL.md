---
name: review
description: Load for a review, audit or critique of code, design, instructions or a PR body.
---

# Review

- **Scope**: immutable base/head pairs against the accepted requirements, repository contracts and canonical examples. Trace changed contracts through their real consumers and the failure, concurrency, resource-lifetime and previous-release data paths. Judge ownership and architecture, not just lines.
- **One complete pass** reports every defect class; later rounds cover the fixes and the contracts they touch.
- **No edits.** Tests, probes and services as evidence needs, in your own preview tab (`preview_open` with `reuseExistingTab: false`). Name missing proof.

## Findings

Each names severity, `path:line`, a reachable input, the violated contract, evidence and the smallest fix; every instance of a class once. Not findings: taste without a rule, hypothetical callers, what lint covers. Pre-existing defects stay apart from those the change introduces or relies on.

| Severity | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| P1       | Broken user/caller contract, data loss, secret exposure, missing migration or false claim   |
| P2       | Repository ownership, boundary or reference violation; unnecessary, duplicated or dead code |
| P3       | Naming, wording or style                                                                    |

- **Claims** against their evidence, not the author's summary. The PR body and its captures as a reader without the chat, against its template. With no P1 or P2 left, say the covered scope.
- **UI**: responsive input, retained valid content, loading confined to the affected region, requests limited to the interaction's needs.
- **Instructions**: the affected system as a whole: contradictions, duplicated facts, misplaced rules, restatements of what the harness or tools say, constraints whose cause is gone. The smallest correction that complements the model.
