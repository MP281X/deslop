---
name: review
description: 'Read-only, evidence-backed review of code, architecture, cleanup, designs, instructions and published artifacts. Use for reviews, audits and critiques; the author owns implementation, services and browser interaction.'
---

# Review

Challenge the work independently. Trace the contract, try its strongest reachable counterexample and establish the consequence before reporting a defect. The author's rationale is a hypothesis, not authority. Apply the available engineering, architecture, design and testing skills by name; when one is unavailable, use the repository's explicit contracts without inventing its rules.

## Code review

Review the normalized diff: the author must run Oxfmt and deterministic lint autofix first. Do not spend review reasoning on formatting or already-fixable diagnostics. If normalization is unavailable, name that gap and have the author prepare it; never mutate a read-only target.

- **Depth.** Read every hand-written changed line. For generated output, review the generator change and a sample, such as one package per source format. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. Try the inputs, orderings and failures that the tests miss. When the change refactors a whole file, list each behavior the file had at the merge base and prove that each one still holds, apart from the planned change.
- **Findings.** Report broken behavior or contracts that a real caller's input reaches. Report violations of engineering, design or `CODING_STANDARDS.md` in changed lines, and in every line of a file that the task adds or rewrites. A recurring shape that departs from its canonical example without a request is a finding. For a pattern change, run the Patterns search for the old form and report each remaining consumer. Skip what lint enforces outside legacy lists, and restyling that the change does not need.
- **Beyond the diff.** A contradiction with an unchanged file, a stale reference that the change leaves, and a false assumption that the change rests on are findings.
- **Not findings.** Taste without a rule, wording, hypothetical inputs, and defects that the branch neither made nor relies on.
- **Later rounds.** Retain the covered commit, contracts and scope. Review only uncovered hunks, the fixes since that commit, and their affected consumers. Reuse prior source reads while those sources are unchanged. A confirmed local fix needs no new independent round unless it introduces an uncovered contract, mechanism or failure path. A new notice or a changed PR body is not a code-review trigger.
- **Probes.** Settle a suspicion with disposable inline code against the public interface, real data or installed artifact. Use the repository's runtime command, such as `vp node -e '<script>'` or `vp env exec bun -e '<script>'`; verify that it loads the source and dependencies. Do not create a test file, worktree or test-only seam to answer one question. Never start a service or test suite during read-only review.
- **Browser evidence.** Inspect the existing preview, captures, console and relevant requests without changing page state. Give the owner the smallest missing browser action and observable result to check; the owner drives the browser and records it. A screenshot proves a visible state, not unobserved timing, persistence or release behavior.
- **Test value.** Use testing to decide whether a permanent test protects a distinct plausible regression. Do not demand a new test for every finding when an inline probe or existing browser proof settles it.
- **Variants.** After reproducing a defect, look for the same root cause in its other real callers. Broaden one dimension at a time and stop when unrelated hypotheses replace concrete evidence.

Return the findings, or "Clean" with the covered scope. Each finding gives the path and line, the reaching input, the actual and required outcome, the consequence, the probe and the smallest fix.

## Cleanup audit

Classify every changed file and hunk against the user's outcome and the reachable existing contracts. The author's plan does not authorize added scope. Default to removal, but preserve security, accessibility, required dependencies and useful regression protection:

- **Revert:** unrelated formatting, lint-only rewrites, renames, reordered keys and files. Retain a required root fix and the repository's explicit cleanup scope. Do not weaken valid rules to retain obsolete code.
- **Supersede:** features and versions that the final direction replaced, compatibility for unreleased versions, and capabilities that only a test or demo needed.
- **Simplify:** the same behavior with less code or a clearer layout: files, folders and names that break the repository's layout, dead code, unused exports, duplicate logic, layered overrides, no-ops and workarounds.
- **Cut:** anything the request does not need: features, function branches, files, libraries, settings, config values, UI elements, and machinery such as budgets, retries, caches, fallbacks, queues, daemons and dependency patches. Name what the user loses without each one; when he loses nothing, it goes.
- **Keep:** a required outcome, dependency, reachable existing contract or useful regression proof. Quote the requirement or show the caller and the input that break without it.

Read every hand-written hunk; a sample is not an audit. Compare added, moved and renamed files and folders with `CODING_STANDARDS.md` and the closest sibling app or package. Near-empty files and helper files that mix roles are Simplify rows. Judge generated output through its generator and a sample. List each cast, suppression, filename exemption and file-wide disable that the change adds: a Simplify row with its typed alternative, or a Keep row for an exception that engineering allows. Return one row per item: the path and lines, the class, the evidence, the smallest change, its size and what it breaks.

## Critique

Challenge the outcome, the taste and the attempts so far, and do not defer to the author. Compare different mechanisms, including a smaller one. Test the strongest counterexample and the weakest assumption. Prefer a reversible combination of compatible strengths. Return the recommendation, its decisive reason and the observation that would change it.

## Instruction review

Review the affected instructions as one system: prompts, skills, references, settings, repository rules and installed copies in the requested scope. Read every relevant file whole. Check each rule against the runtime and tool behavior it assumes, in source or a real session. Installation belongs to the configuration owner, not the reviewer.

Report contradictions, duplicate rules, rules that only one harness gets, rules that no agent can act on, stale names, paths and models, breaks of applicable repository language rules, text that does not change an agent's action, and eval claims without evidence. Return the findings ranked, each with the path and line, the probe and the smallest change.

## Body reader

Read the published pull request as a reviewer who knows nothing else. Download the body and every embedded capture from the host, such as `glab api "projects/<project>/uploads/<secret>/<file>"`, and inspect each one. Compare them with the branch head and the source tickets. Report:

- A risk that a tired reviewer misses: a migration, contract change or removed behavior the published body does not name.
- A claim that a capture or the code contradicts.
- A ticket requirement without proof.
- A capture that is unreadable, ends before its outcome, or shows loading that is not the claim.
- Each departure from the repository's publishing contract or the available delivery skill.

Return each finding with the section, the evidence and the smallest fix.
