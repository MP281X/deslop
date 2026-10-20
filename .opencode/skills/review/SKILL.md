---
name: review
description: 'Use for any review, audit, critique or review round of code, a PR, a design, agent instructions or a PR body.'
---

# Review

**One complete pass.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data, the references), never from the author's summary, and report every class of defect in this pass: a later round only checks the fixes. Load the repository's `AGENTS.md` and the skills the work needed, then answer build's Evaluate questions the change touches: each "no" is a finding.

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
- **Claims.** Check each claim in the PR body, comments and messages against its artifact; one you cannot reproduce is a P1.
- **Requirements.** Map each of the user's requirements to its hunk and proof; one with neither is a finding.
- **Committed state.** Read the commit range you were given, `git show <head>:<path>`, or the pushed head (`gh pr diff <n>`, `glab mr diff <n>`), never the author's working tree. Judge a stack as one change.
- **Browser.** Inspect the existing preview, captures, console and requests without changing page state.

## Lenses

A large change splits the pass into parallel reviewers on the same head, each with one lens and every other part of this skill: **contracts** (callers, data, migrations, failure paths), **shape** (references, owners, what can be deleted) and **proof** (each claim and requirement against its artifact). The lead keeps a finding only with a reachable input and a concrete harm, merges duplicates and drops preferences.

## Instructions

Read the affected prompts, skills, references and settings whole, as one system, and rank by how much agent behavior each finding changes: contradictions, duplicates, a rule in the wrong owner, rules no agent can act on, text that changes no action, stale names, paths and models, a rule that assumes tool behavior it does not have. Read the transcript first: a rule that never loaded needs its trigger; one that loaded and was ignored needs an example or a better place, not more words.

## Body reader

Read the published PR as a reviewer who knows nothing else: the body, every capture downloaded from the host, the branch head and the source tickets. Report a risk the body does not name, a claim the code or a capture contradicts, a requirement without proof and an unreadable capture.
