---
name: verification
description: Load before claiming done, before a review, and when a result must be proven rather than asserted.
---

# Verification

Verification is the proof; a review is one mode.

## Modes

| Situation            | Proof                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UI                   | Full matrix for a screen-level change; a one-line CSS fix checks the touched states at both viewports. Rows: default, empty, loading, error, long, phone and desktop, light and dark, plus the named state. Preview or device; assertions for overflow, token styles, accessible names and focus. Compare to the chosen mix. |
| Architecture/cleanup | Each replaced item is deleted, or kept with a reason. Use `rg` and Fallow to rank code candidates; Scope `find` only proves runtime reachability. Require caller or registration evidence plus a reachable-path probe before deleting.                                                                                       |
| Behavior             | Failing probe on base, passing on head; real data; edge states.                                                                                                                                                                                                                                                              |
| Performance          | Same workload, repeated runs, p50/p95, resource cost; Scope traces and `measure_latency`.                                                                                                                                                                                                                                    |
| Copy/docs            | Rendered in the real consumer — Safari print, PDF, device — not a browser substitute.                                                                                                                                                                                                                                        |
| Code                 | Immutable base/head; contracts, ownership, dead code, reaching input. Instructions: contradictions, duplicated facts, misplaced rules, restatements.                                                                                                                                                                         |

## Rules

- **Observation.** Each finding states claim, reproduction, observed output or path. Anything without an observation is `conjecture`.
- **Clean.** A clean verdict needs the probes you ran and one attempt to break the change, with the result. Otherwise return `NOT VERIFIED` and say what stopped you. Zero tool calls is invalid.
- **Reviewer.** Different model or stance from the writer. UI reviewers open their own preview tab — the review brief is the request — and return a filled matrix; source reading is not evidence.
- **Video.** A behavior or UI change gets a short recording of the real journey; pull-requests owns its composition and attachment.
- **Stop.** One complete review pass; one re-check after fixes. No re-check of the same diff without a failed probe.

## Findings

Each names severity, `path:line`, a reachable input, the violated contract, evidence and the smallest fix; every instance of a class once. Not findings: taste without a rule, hypothetical callers, what lint covers. Pre-existing defects stay apart.

| Severity | Meaning                                                                                     |
| -------- | ------------------------------------------------------------------------------------------- |
| P1       | Broken user/caller contract, data loss, secret exposure, missing migration or false claim   |
| P2       | Repository ownership, boundary or reference violation; unnecessary, duplicated or dead code |
| P3       | Naming, wording or style                                                                    |
