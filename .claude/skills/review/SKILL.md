---
name: review
description: 'Use for any review, audit, critique or review round of code, a PR, a design, agent instructions or a PR body.'
---

# Review

**One complete pass.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data, the references), never from the author's summary, and report every class of defect in this pass: a later round checks the fixes and their affected contracts. Judge the diff against the repository's `CODING_STANDARDS.md`, `AGENTS.md` and relevant rules; consult another skill only for a gap this review needs resolved.

## Findings

Each finding: severity, `path:line`, the reaching input, actual and required outcome, the artifact that showed it (probe output, request, trace, capture, source line), the smallest fix.

| Severity | Meaning                                                                                                                            |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or a claim is false or ungrounded                |
| P2       | Wrong owner, boundary or shape against its reference, rule violation, duplicated or dead code, or a part the request does not need |
| P3       | Naming, wording or style                                                                                                           |

- **Every instance.** Each class once, with every instance's `path:line`, across every layer.
- **Rank honestly.** P1 first; "Clean" with the covered scope when nothing reaches P2; no padding with P3.
- **Not findings:** taste without a rule or reference, inputs no caller sends, defects the change neither made nor relies on, what lint reports.
- **Probe** a suspicion inline against the public interface; never start a service or test suite in a read-only review.

## Code

- **Architecture first.** Rebuild the change from the request and its references alone: state owners, boundaries, files, data flow. Where its shape differs from the reference's or the simplest idiomatic one, report it with that shape as the fix, even when every line is correct.
- **Depth.** Read every hand-written changed line, and for generated output the generator change and a sample; trace each contract through its real consumers, failure paths, concurrency and resource ownership, and persisted data from the previous release.
- **Claims.** Check each claim in the PR body, comments and messages against its artifact; a false or unsupported claim is a P1.
- **Requirements.** Resolve approvals against the proposals they approve, not the author's summary. Map accepted requirements, including public names and paths, to the final implementation and evidence; a cosmetic substitute or an unapproved deviation is a finding.
- **Committed state.** Read the supplied immutable base/head pairs, `git show <head>:<path>`, or the pushed heads (`gh pr diff <n>`, `glab mr diff <n>`), never the author's working tree. Judge related PRs together, including independent branches, and each slice on its actual base.
- **Browser.** Inspect the existing preview, captures, console and requests without changing page state.

## Lenses

**Contracts** (callers, data, migrations, failure paths), **shape** (references, owners, what can be deleted) and **proof** (each claim and requirement against its artifact); a reviewer given one lens applies every other part of this skill through it. The lead keeps a finding with a reachable input and a concrete harm, or a shape that departs from its reference, merges duplicates and drops preferences.

## Evaluate

Apply the questions the change touches, using existing evidence first; report findings, not a checklist of affirmative answers. A read-only reviewer identifies missing proof for the author rather than running repository checks, changing code or driving the preview. Use the repository's policy and supported targets, not invented budgets, a fixed device matrix or personal taste imposed on another team.

| Question                                                              | Deciding evidence                                                                                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Does the demonstration prove the requested journey, not a proxy?      | Per delivery, real input through each materially changed outcome and relevant failure path. A health check, successful exit or green suite proves only its own stage, not that the consumer works.                                                                                                                  |
| Does each boundary reduce reading cost?                               | Substantive code and caller/import relationships: private implementation near its consumer, genuinely shared behavior in one owner, without replacing indirection with an unmanageable file. Fewer lines alone do not justify a boundary.                                                                           |
| What required behavior is missing from existing owners or primitives? | Their exports and real consumers, plus a concrete reason reuse or composition cannot meet the requirement. A wrapper earns its place only by lowering actual complexity.                                                                                                                                            |
| Does the shipped result match its agreed reference and conventions?   | Same-data reference/result captures and element boxes for deciding geometry, alignment, clipping and hierarchy, using the existing theme and layout owners.                                                                                                                                                         |
| Does each persistent test protect reachable, owned behavior?          | The repository's test policy, reaching input and assertion: detect incorrect behavior without freezing equivalent implementations or re-testing libraries/types. Judge protection, not the regression label; request a targeted sensitivity probe only when needed.                                                 |
| Is interaction responsive on first load, navigation and revisit?      | Real interaction recording, requests and timings/traces against the baseline: input stays locally responsive, still-valid available content stays visible and loading feedback belongs to the affected region. Initial loading and repeat navigation are different states; cosmetic progress is not responsiveness. |
| Are async work and data scoped to the current need?                   | Actual request payloads/counts and resource lifetimes on representative data; obsolete cancelable work stops, ownership prevents redundant subscriptions or loading boundaries, and a small interaction does not fetch an unrelated corpus.                                                                         |
| Are relevant states and failure paths reachable and correct?          | Changed empty, loading, partial, stale, error, success and long-content paths; evidence appropriate to the state, not a capture for every hypothetical combination.                                                                                                                                                 |
| Does every added part serve the final requirement?                    | A reachable requirement or consumer that needs it, across the whole related PR set; no superseded approach, unused variant or unrelated cleanup kept merely because it was already built.                                                                                                                           |

## Instructions

Read the affected prompts, skills, references and settings whole, as one system, and rank by how much agent behavior each finding changes: contradictions; one meaning in two places; a rule in the wrong owner; a no-op the model already does by default; a sentence a leading word could replace; a prohibition without the behavior to do instead; stale names, paths and models; a rule that assumes tool behavior it does not have.

## Body reader

Read the published body, captures and head without the chat: it must explain the PR's complete change, not its implementation tour. Check that Markdown structure exposes distinct changes and comparisons. Flag repeated summaries, process, inventories and low-level detail already in the diff. Require delivery's real input-to-outcome demonstration, including non-UI changes. Report material risks omitted, unsupported claims, missing proof and unreadable captures; preserve material verification limits.
