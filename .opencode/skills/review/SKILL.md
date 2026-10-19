---
name: review
description: 'Use for any review, audit, critique or review round of code, a PR, a design, agent instructions or a PR body.'
---

# Review

**Adversarial.** Build the strongest case that the work is wrong from raw evidence (the code, real runs, data), never from the author's summary. Load the skills the work needed and the repository's `AGENTS.md` with the standards it links, then answer each loaded skill's Critique against the change: a question it fails is a finding.

## Findings

Each finding: severity, `path:line`, the reaching input, actual and required outcome, the probe that showed it, the smallest fix.

| Severity | Meaning                                                                                                             |
| -------- | ------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or a claim is false               |
| P2       | Wrong owner, boundary or organization, rule violation, duplicated or dead code, or a part the request does not need |
| P3       | Naming, wording or style                                                                                            |

- **One pass.** Every class once, with every instance's `path:line`, across every layer; a later round checks the earlier fixes and reads only the commits since.
- **Rank honestly.** P1 first; "Clean" with the covered scope when nothing reaches P2; no padding with P3.
- **Not findings:** taste without a rule, inputs no caller sends, defects the change neither made nor relies on, what lint reports.
- **Probe** a suspicion inline per engineering's Spike; never start a service or test suite in a read-only review.

## Code

- **Architecture first.** Rebuild the change from the request alone: state owners, boundaries, files, data flow, mechanism. Where its shape differs from the simplest idiomatic one (fewer parts, the existing pattern, Effect's own building blocks), report it with that shape as the fix, even when every line is correct.
- **Depth.** Read every hand-written changed line, and for generated output the generator change and a sample; trace each contract through its real consumers, failure paths, concurrency and resource ownership.
- **Simplicity.** Name each part the request does not need (script, flag, option, wrapper, fallback, reimplemented library job, control, test) and each abstraction that saves lines without lowering what a reader holds; name duplicated blocks with both locations.
- **Requirements.** Map each of the user's requirements to its hunk and proof; one with neither is a finding.
- **Beyond the diff.** A contradiction with an unchanged file, a stale reference the change leaves, a false assumption it rests on.
- **Committed state.** Read the commit range you were given, `git show <head>:<path>`, or the pushed head (`gh pr diff <n>`, `glab mr diff <n>`), never the author's working tree. Judge a stack as one change and report what crosses layers.
- **Browser.** Inspect the existing preview, captures, console and requests without changing page state.

## Cleanup audit

Classify every changed hunk against the request; the author's plan authorizes nothing. One row per item: path and lines, class, evidence, smallest change, what it breaks.

- **Revert:** unrelated formatting, renames, reordering.
- **Supersede:** what the final direction replaced, compatibility for unreleased versions, what only a test or demo needed.
- **Simplify:** the same behavior with less code; each cast or suppression with its typed alternative.
- **Cut:** what the request does not need; name what the user loses, and nothing lost means it goes.
- **Keep:** a required outcome or reachable contract, with the caller that breaks without it.

## Approach critique

Compare different mechanisms, including a smaller one; test the strongest counterexample and the weakest assumption. Return the recommendation, its deciding reason and the observation that would change it.

## Instruction review

Read the affected prompts, skills, references and settings whole, as one system, and rank by how much agent behavior each finding changes: contradictions, duplicates, a rule in the wrong owner, rules no agent can act on, text that changes no action, a paragraph a leading term would carry, stale names, paths and models, a rule that assumes tool behavior it does not have.

- **Missed or ignored.** Read the transcript first: a skill that never loaded needs its trigger; a clear rule that loaded and was ignored needs a better place or form, not more words.
- **Form.** Wrong-shaped output gets an example, an omission a required slot, a conditional behavior an observable trigger.
- **Settle** disputed wording by how agents behaved in real threads.

## Body reader

Read the published PR as a reviewer who knows nothing else: the body, every capture downloaded from the host, the branch head and the source tickets. Report a risk the body does not name, a claim the code or a capture contradicts, a requirement without proof and an unreadable capture.
