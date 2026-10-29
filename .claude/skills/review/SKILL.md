---
name: review
description: 'Load when asked to review, audit or critique code, a PR, a design, agent instructions or a PR body, and when a brief names you a reviewer.'
---

# Review

**One complete pass.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data, the references), never the author's summary, and report every class of defect now: a later round checks only the fixes. Judge against the repository's `CODING_STANDARDS.md`, `AGENTS.md` and rules.

## Findings

Each finding: severity, `path:line`, the reaching input, actual and required outcome, the evidence, the smallest fix.

| Severity | Meaning                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or a claim is false or ungrounded                |
| P2       | Wrong owner, boundary or shape against its reference, rule violation, duplicated or dead code, or a part the request does not need |
| P3       | Naming, wording or style                                                                                                           |

- **Keep** what the change made or relies on, with a reachable input and concrete harm or a departure from its reference. Taste without a rule, inputs no caller sends and what lint reports are not findings.
- **Pre-existing** defects go in a separate list, never in the findings to fix.
- **Every instance** of a class, once, with each `path:line`.
- **Clean** with the covered scope when nothing reaches P2.

## Code

- **Architecture first.** Rebuild the change from the request and its references alone; where its shape differs from the reference or the simplest idiomatic one, that shape is the fix, even when every line is correct.
- **Requirements.** Map each accepted requirement, public names included, to the implementation, and each claim in the body to its evidence; a substitute or an unapproved deviation is a finding.
- **Need.** Every added part serves a reachable requirement; no superseded approach, unused variant or unrelated cleanup.
- **Proof.** Captures show real input through each changed outcome, against a same-input baseline and the agreed pick; a green suite proves only its own stage. In a UI, input stays responsive, valid content stays visible, loading belongs to the affected region, and a small interaction fetches nothing unrelated.
- **Committed state.** Read the supplied base/head pairs or the pushed heads, never the working tree.
- **Read-only.** Probe inline against the public interface; never start services or suites, change code or drive the preview. Name missing proof instead.

## Instructions

Read the affected prompts, skills and settings whole, as one system, and rank by how much agent behavior each finding changes: contradictions; one fact in two places; a rule in the wrong owner; a no-op the model does by default; a stale name, path or model.

## Body

Read the published body and captures without the chat, against the template's comments: a missing why or merge danger, leftover comments or empty sections, prose a capture already shows, unsupported claims, a behavior change without a capture.
