---
name: review
description: 'Use for any review, audit, critique or review round of code, a PR, a design, agent instructions or a PR body.'
---

# Review

Do what a short seller does to a position: build the strongest case that the work is wrong from raw evidence (the code, real runs, data), never from the author's summary or rationale. Before you report, name what a top expert in the area would check that the brief did not ask for, and check it. Load every skill the work needed (engineering for code, design for visible output, and the other skills the checkout has for the task) with the repository's `CODING_STANDARDS.md` and agent instructions; last, answer each loaded skill's Critique against the change, as its author should have: a question the change fails is a finding.

## Findings

Each finding: severity, `path:line`, the reaching input, actual and required outcome, the probe that showed it, the smallest fix.

| Severity | Meaning                                                                                                                                     |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| P1       | Breaks a user or caller contract, loses data, misses a migration, leaks a secret, or a claim is false                                       |
| P2       | Wrong owner, boundary or organization, rule violation, duplicated or dead code, or a mechanism, option or element the request does not need |
| P3       | Naming, wording or style                                                                                                                    |

- **Classes.** Report a defect class once, with every instance's `path:line`; never repeat a finding an earlier round raised and the author answered.
- **Rank honestly.** Never inflate a P3 to keep it alive; never pad a report with P3 to look thorough. Return P1 first; "Clean" with the covered scope when nothing reaches P2.
- **Not findings:** taste without a rule, hypothetical inputs no caller sends, defects the branch neither made nor relies on, what lint reports outside legacy lists.
- **Probe** a suspicion inline per engineering's Proof; never start a service or test suite in a read-only review.

## Code

- **Architecture first.** Before the lines, rebuild the change from the request alone: who owns each piece of state, the boundaries, the file and module organization, the data flow and the mechanism. The first pass usually gets this wrong, so attack it: wherever the change's shape differs from the simplest idiomatic one (fewer parts, the existing pattern, Effect's own building blocks), report it with that shape as the fix, even when every line is correct.
- **Depth.** Read every hand-written changed line; for generated output, the generator change and a sample. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. A whole-file refactor keeps every behavior the file had.
- **Simplicity.** Name each part the request does not need: a script, flag, option, wrapper, fallback, reimplemented library job, UI control or test, and each abstraction (helper, shared constant, generic, factory) that saves lines without lowering what a reader must hold. Name each block that duplicates code already in the repository, with both locations.
- **Requirements.** Map each of the user's requirements to the hunk and the proof that meet it; a requirement with neither is a finding, even when no line changed for it.
- **Production data.** A changed persisted shape without a migration that converts existing data is P1.
- **Beyond the diff.** A contradiction with an unchanged file, a stale reference the change leaves, or a false assumption it rests on.
- **Rounds.** Read the pushed head, never the author's working tree, which keeps changing: `gh pr diff <n>`, `glab mr diff <n>`, `git show <head>:<path>`. Judge the layer as one change; spend depth on commits since the last reviewed one. A stack overview reports what crosses layers: duplication, a contract one layer breaks for another, code in the wrong layer.
- **Browser.** Inspect the existing preview, captures, console and requests without changing page state; name the smallest missing check for the author.

## Cleanup audit

Classify every changed hunk against the request; the author's plan authorizes nothing. One row per item: path and lines, class, evidence, smallest change, what it breaks.

- **Revert:** unrelated formatting, renames, reordering.
- **Supersede:** what the final direction replaced, compatibility for unreleased versions, capabilities only a test or demo needed.
- **Simplify:** the same behavior with less code: dead code, unused exports, duplicate logic, layered overrides, near-empty files, each cast or suppression with its typed alternative.
- **Cut:** what the request does not need: features, branches, files, libraries, settings, UI elements, budgets, retries, caches, fallbacks, queues, daemons. Name what the user loses; nothing lost, it goes.
- **Keep:** a required outcome or reachable contract, with the caller that breaks without it.

## Approach critique

Compare different mechanisms, including a smaller one; test the strongest counterexample and the weakest assumption. Return the recommendation, its deciding reason and the observation that would change it.

## Instruction review

Read the affected prompts, skills, references and settings whole, as one system. Report contradictions, duplicated rules, a rule in the wrong owner, rules no agent can act on, text that changes no action, wording that over-explains what a frontier model infers from a leading word, stale names, paths and models. Check each rule against the real tool behavior it assumes. Rank by how much agent behavior each finding changes.

- **Missed or missing.** For a failure, read the transcript first: a skill that never loaded needs its trigger fixed; a clear rule that loaded and was ignored needs a better place or form, not more words.
- **Form.** Wrong-shaped output gets a recipe or a good example, an omission a required slot, a conditional behavior an observable trigger; a prohibition alone only names the mistake.
- **Settle** disputed wording by how agents behaved in real threads, not by debate.

## Body reader

Read the published PR as a reviewer who knows nothing else: the body, every capture downloaded from the host, the branch head and the source tickets. Report a risk the body does not name (migration, contract, removed behavior), a claim the code or a capture contradicts, a ticket requirement without proof, and an unreadable capture.
