---
name: review
description: Read-only review of code, cleanup, designs, instructions and published pull request bodies. Use for reviews, audits and critiques; orchestrator schedules delivery gates and delivery owns publishing.
---

# Review

Assume the work is wrong and prove where. Settle each suspicion yourself with a read-only inline probe against the real code, data, installed files or sessions; the author runs checks and test suites. Rank findings by consequence.

## Code review

- **Depth.** Read every hand-written changed line. For generated output, review the generator change and a sample, such as one package per source format. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. Try the inputs, orderings and failures that the tests miss. When the change refactors a whole file, list each behavior the file had at the merge base and prove that each one still holds, apart from the planned change.
- **Findings.** Report broken behavior or contracts that a real caller's input reaches. Report violations of engineering, design or `CODING_STANDARDS.md` in changed lines, and in every line of a file that the task adds or rewrites. Skip what lint enforces outside legacy lists, and restyling that the change does not need.
- **Beyond the diff.** A contradiction with an unchanged file, a stale reference that the change leaves, and a false assumption that the change rests on are findings.
- **Not findings.** Taste without a rule, wording, hypothetical inputs, and defects that the branch neither made nor relies on.
- **Later rounds.** Review only uncovered hunks, the fixes since the reviewed commit, and their consumers.
- **Probes.** Run inline scripts with the probe command the repository reference names, by default `vp node -e '<script>'`, or `vp env exec bun -e '<script>'` in a Bun repository. Never start the app or a test suite. Report when a probe cannot load TypeScript.

Return the findings, or "Clean" with the covered scope. Each finding gives the path and line, the reaching input, the actual and required outcome, the consequence, the probe and the smallest fix.

## Cleanup audit

Classify every changed file and hunk in your area against the user's messages, quoted in the brief. Ignore any plan or "keep the behavior" note, which holds the author's own additions. Default to removal:

- **Revert:** churn such as formatting, lint-only rewrites, renames, reordered keys and unrelated files, except root fix changes on new lines and in the cleanup pull request. Propose the default branch's code, with a lint downgrade or a reasoned disable where new rules fail it.
- **Supersede:** features and versions that the final direction replaced, compatibility for unreleased versions, and capabilities that only a test or demo needed.
- **Simplify:** the same behavior with less code or a clearer layout: files, folders and names that break the repository's layout, dead code, unused exports, duplicate logic, layered overrides, no-ops and workarounds.
- **Cut:** anything the request does not need: features, function branches, files, libraries, settings, config values, UI elements, and machinery such as budgets, retries, caches, fallbacks, queues, daemons and dependency patches. Name what the user loses without each one; when he loses nothing, it goes.
- **Keep:** only what the request's words need, with the words quoted.

Read every hand-written hunk; a sample is not an audit. Compare added, moved and renamed files and folders with `CODING_STANDARDS.md` and the closest sibling app or package. Near-empty files and helper files that mix roles are Simplify rows. Judge generated output through its generator and a sample. List each cast, suppression, filename exemption and file-wide disable that the change adds: a Simplify row with its typed alternative, or a Keep row for an exception that engineering allows. Return one row per item: the path and lines, the class, the evidence, the smallest change, its size and what it breaks.

## Critique

Challenge the outcome, the taste and the attempts so far, and do not defer to the author. Compare different mechanisms, including a smaller one. Test the strongest counterexample and the weakest assumption. Prefer a reversible combination of compatible strengths. Return the recommendation, its decisive reason and the observation that would change it.

## Instruction review

Review the affected agent configuration as one system: both prompts, skills and references, settings, repository rules and installed copies on each running worker. Read every relevant file whole. Check each rule against the harness and T3 behavior it assumes, in their source or a real session.

Report contradictions, duplicate rules, rules that only one harness gets, rules that no agent can act on, stale names, paths and models, breaks of the Language rules, text that does not change an agent's action, and eval claims without evidence. Return the findings ranked, each with the path and line, the probe and the smallest change.

## Body reader

Read the published pull request as a reviewer who knows nothing else. Download the body and every embedded capture from the host, such as `glab api "projects/<project>/uploads/<secret>/<file>"`, and inspect each one. Compare them with the branch head and the source tickets. Report:

- A risk that a tired reviewer misses: a migration, contract change or removed behavior that the Check part does not name.
- A claim that a capture or the code contradicts.
- A ticket requirement without proof.
- A capture that is unreadable, ends before its outcome, or shows loading that is not the claim.
- Each departure from the [example body](../delivery/SKILL.md#example-body).

Return each finding with the section, the evidence and the smallest fix.
