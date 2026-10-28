---
name: review
description: 'Load when asked to review, audit or critique code, a PR, a design, agent instructions or a PR body, and when a brief names you a reviewer.'
---

# Review

**One complete pass.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data, the references), never the author's summary, and report every class of defect now: a later round checks only the fixes. Judge against the repository's `CODING_STANDARDS.md`, `AGENTS.md` and rules.

## Findings

Each finding: severity, `path:line`, the reaching input, actual and required outcome, the artifact that showed it, the smallest fix.

| Severity | Meaning                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or a claim is false or ungrounded                |
| P2       | Wrong owner, boundary or shape against its reference, rule violation, duplicated or dead code, or a part the request does not need |
| P3       | Naming, wording or style                                                                                                           |

- **Keep** a finding the change made or relies on, with a reachable input and concrete harm or a shape that departs from its reference. Taste without a rule or reference, inputs no caller sends and what lint reports are not findings.
- **Pre-existing.** A defect the change neither made nor relies on goes in a separate `Pre-existing` list with its `path:line`, never in the findings to fix.
- **Every instance.** Each class once, with every instance's `path:line`, across every layer.
- **Clean** with the covered scope when nothing reaches P2; no padding with P3.

## Code

- **Architecture first.** Rebuild the change from the request and its references alone: owners, boundaries, files, data flow. Where its shape differs from the reference's or the simplest idiomatic one, report that shape as the fix, even when every line is correct.
- **Claims and requirements.** Check each claim in the PR body against its artifact, and map each accepted requirement, public names included, to the implementation, reading an approval against the proposal it approved; a cosmetic substitute or an unapproved deviation is a finding.
- **Committed state.** Read the supplied immutable base/head pairs or the pushed heads (`gh pr diff <n>`, `glab mr diff <n>`), never the working tree; judge each slice on its actual base.
- **Read-only.** Probe a suspicion inline against the public interface; never start a service or test suite, change code or drive the preview. Name missing proof instead.

## Evaluate

- **Proof.** The capture shows real input through each changed outcome, with a same-input baseline when the claim is a difference; a green suite proves only its own stage.
- **Reference.** Same-data captures and element boxes match the agreed pick and theme.
- **Speed.** A real interaction recording, requests and traces against the baseline: input stays responsive, still-valid content stays visible, loading feedback belongs to the affected region, and a small interaction fetches no unrelated data.
- **Need.** Every added part serves a reachable requirement across the related PR set; no superseded approach, unused variant or unrelated cleanup kept because it was already built.

## Instructions

Read the affected prompts, skills, references and settings whole, as one system, and rank by how much agent behavior each finding changes: contradictions; one fact in two places; a rule in the wrong owner; a no-op the model does by default; a stale name, path or model; a rule that assumes tool behavior it lacks.

## Body reader

Read the published body and captures without the chat, against the repository's PR template. Flag a missing why or merge danger; leftover template comments or empty sections; restated diff, work history or prose a capture already shows; unsupported claims; unreadable captures; a behavior change without a capture.
