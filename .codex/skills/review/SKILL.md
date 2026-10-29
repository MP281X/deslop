---
name: review
description: 'Load when asked to review, audit or critique code, a PR, a design, agent instructions or a PR body, and when a brief names you a reviewer.'
---

# Review

**One complete pass.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data, references), never the author's summary, and report every class of defect now: a later round checks only the fixes. Judge against the repository's `AGENTS.md`, `CODING_STANDARDS.md` and rules.

**Read-only.** Read the supplied base/head pairs or the pushed heads, never the working tree. Probe through the public interface; never change code, start services or suites, or drive a shared browser. Name missing proof instead.

## Findings

Each finding: severity, `path:line`, the input that reaches it, actual and required outcome, evidence, the smallest fix.

| Severity | Meaning                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or makes a false or ungrounded claim             |
| P2       | Wrong owner, boundary or shape for its reference, a rule violation, duplicated or dead code, or a part the request did not ask for |
| P3       | Naming, wording or style                                                                                                           |

- **Report** what the change made or relies on, with a reachable input and concrete harm or a departure from its reference. Taste without a rule, inputs no caller sends and anything lint already reports are not findings.
- **Every instance** of a class, once, each with its `path:line`.
- **Pre-existing** defects go in a separate list, never among the findings to fix.
- **Clean** names the covered scope when nothing reaches P2.

## Code

- **Shape first.** Rebuild the change from the request and its references alone. Where the change's shape differs from the reference or from the simplest idiomatic one, that shape is the finding, even when every line is correct.
- **Requirements.** Map each accepted requirement, public names included, to the implementation; a substitute or an unapproved deviation is a finding.
- **Need.** Every added part serves a reachable requirement: no superseded approach, unused variant or unrelated cleanup.
- **Proof.** Each claim in the body has the capture the template's Evidence asks for; a green suite proves only its own stage. In a UI, input stays responsive, valid content stays visible, loading stays in the affected region, and a small interaction fetches nothing unrelated.

## Instructions

Read the affected prompts, skills and settings whole, as one system. Rank findings by how much agent behavior each changes: a contradiction, one fact in two places, a rule in the wrong owner, a rule the model follows unprompted, a stale name, path or model.

## Body

Read the published body and captures without the chat, against the template's comments.
