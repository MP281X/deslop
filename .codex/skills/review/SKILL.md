---
name: review
description: 'Use for any review, audit, critique or review round of code, a PR, a design, agent instructions or a PR body.'
---

# Review

**One complete pass.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data, the references), never the author's summary, and report every class of defect now: a later round checks only the fixes and the contracts they touch. Judge against the repository's `CODING_STANDARDS.md`, `AGENTS.md` and rules.

## Findings

Each finding: severity, `path:line`, the reaching input, actual and required outcome, the artifact that showed it (probe output, request, trace, capture, source line), the smallest fix.

| Severity | Meaning                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or a claim is false or ungrounded                |
| P2       | Wrong owner, boundary or shape against its reference, rule violation, duplicated or dead code, or a part the request does not need |
| P3       | Naming, wording or style                                                                                                           |

- **Keep** a finding the change made or relies on, with a reachable input and concrete harm or a shape that departs from its reference, resting on no unstated assumption. Taste without a rule or reference, inputs no caller sends and what lint reports are not findings.
- **Every instance.** Each class once, with every instance's `path:line`, across every layer.
- **Rank honestly.** P1 first; "Clean" with the covered scope when nothing reaches P2; no padding with P3.
- **Probe** a suspicion inline against the public interface; a read-only review never starts a service or test suite.

## Code

- **Architecture first.** Rebuild the change from the request and its references alone: owners, boundaries, files, data flow. Where its shape differs from the reference's or the simplest idiomatic one, report that shape as the fix, even when every line is correct.
- **Depth.** Read every hand-written changed line, and for generated output the generator change and a sample; trace each contract through its real consumers, failure paths, concurrency, resource ownership and the previous release's persisted data.
- **Claims.** Check each claim in the PR body, comments and messages against its artifact; a false or unsupported one is a P1.
- **Requirements.** Map each accepted requirement, public names and paths included, to the implementation and its evidence, reading an approval against the proposal it approved rather than the author's summary; a cosmetic substitute or an unapproved deviation is a finding.
- **Committed state.** Read the supplied immutable base/head pairs, `git show <head>:<path>` or the pushed heads (`gh pr diff <n>`, `glab mr diff <n>`), never the working tree; judge related PRs together and each slice on its actual base.
- **Browser.** Inspect the existing preview, captures, console and requests without changing page state.

## Lenses

**Contracts** (callers, data, migrations, failure paths), **shape** (references, owners, what can be deleted) and **proof** (claims and requirements against artifacts): a reviewer given one lens applies the rest of this skill through it. The lead merges duplicates and applies Keep.

## Evaluate

Apply the questions the change touches, existing evidence first, and report defects, not passed checks. A read-only reviewer names missing proof rather than running checks, changing code or driving the preview. Use the repository's policy and supported targets, not invented budgets, a fixed device matrix or personal taste.

| Question                                                              | Deciding evidence                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the demonstration prove the requested journey, not a proxy?      | Per delivery, real input through each changed outcome and failure path, beside its before on the same input. A health check, a clean exit or a green suite proves only its own stage.                                  |
| Does each boundary reduce reading cost?                               | Callers and imports: private code near its consumer, shared behavior in one owner, no unmanageable file in place of indirection. Fewer lines alone do not justify a boundary.                                          |
| What required behavior is missing from existing owners or primitives? | Their exports and real consumers, and a concrete reason reuse or composition falls short. A wrapper earns its place only by lowering actual complexity.                                                                |
| Does the shipped result match its agreed reference and conventions?   | Same-data reference and result captures, and element boxes for geometry, alignment, clipping and hierarchy, through the existing theme and layout owners.                                                              |
| Does each persistent test protect reachable, owned behavior?          | The repository's test policy, reaching input and assertion: it catches incorrect behavior without freezing equivalent implementations or re-testing libraries and types; a sensitivity probe only when needed.         |
| Is interaction responsive on first load, navigation and revisit?      | A real interaction recording, requests and traces against the baseline: input stays responsive, still-valid content stays visible and loading feedback belongs to the affected region. Cosmetic progress is not speed. |
| Are async work and data scoped to the current need?                   | Request payloads, counts and resource lifetimes on representative data: obsolete work stops, no redundant subscriptions or loading boundaries, and a small interaction fetches no unrelated corpus.                    |
| Are relevant states and failure paths reachable and correct?          | Changed empty, loading, partial, stale, error, success and long-content paths, with evidence fit for each, not a capture per hypothetical combination.                                                                 |
| Does every added part serve the final requirement?                    | A reachable requirement or consumer across the related PR set; no superseded approach, unused variant or unrelated cleanup kept because it was already built.                                                          |

## Instructions

Read the affected prompts, skills, references and settings whole, as one system, and rank by how much agent behavior each finding changes: contradictions; one fact in two places; a rule in the wrong owner; a no-op the model does by default; a non-obvious rule without its reason; a prohibition without the behavior to do; stale names, paths and models; a rule that assumes tool behavior it lacks.

## Body reader

Read the published body, captures and head without the chat, as the reviewer delivery's Body writes for. Flag a missing why, decision or risk the diff cannot show; restated diff, process, inventories and history of the work; unsupported claims; a missing before and after; unreadable captures. Keep material verification limits.
