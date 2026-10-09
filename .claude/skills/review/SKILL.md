---
name: review
description: Read-only reviews of code, cleanup, directions and published pull request bodies. Use when the user asks for a review, an audit or a critique, or when a brief names one of these procedures.
---

# Review

Assume the work is wrong and prove where. Settle each suspicion yourself with a read-only inline probe, and never ask the author to try it; the author runs checks and test suites. Reply in at most 40 lines, most consequential first. Group related findings rather than drop any, and never move results into `<details>` or a file.

Code reviews, cleanup audits and body readers run GPT-6.1 Sol at high effort on the Standard service tier, because Codex goes deeper and argues harder. Critiques run Opus 5.5 at high effort. A child follows only its procedure, works read-only and never delegates.

## Code review

- **Depth.** Read every hand-written changed line. For generated output, review the generator change and a representative subset, such as one package per source format. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. Try the inputs, orderings and failures that the author's tests miss. When the layer refactors a whole touched file, list each behavior the file had at the merge base and prove that each one still holds, apart from the planned change.
- **Findings.** Report broken behavior or contracts that input from a real caller can reach. Report violations of engineering, design or `CODING_STANDARDS.md` in changed lines, and in every line of a touched file when the repository refactors touched files completely, as Dual does. Skip what lint enforces outside legacy lists, and propose no restyling the change does not otherwise need.
- **Later rounds.** Review only the hunks not yet covered, the fixes since the reviewed commit and their consumers.
- **Not findings.** Taste without a rule, wording preferences, hypothetical inputs and changes the branch did not make are not findings. Code that handles input which engineering and lint never allow is a cleanup finding, not a defect.
- **Probes.** Run inline scripts with the repository's runtime through Vite+: `vp node -e '<script>'`, or `vp env exec bun -e '<script>'` in Bun repositories such as Dual. Never start the app or a test suite; when a probe cannot load TypeScript, report that limit.

Return the findings ranked by consequence, or "Clean" with the scope you covered. Each finding gives the path and line, the reaching input, the actual and required outcome, the consequence, the probe that showed it and the smallest fix.

## Cleanup audit

Classify every changed file and hunk in your area against the plan's intent, and default to removal:

- **Revert:** churn such as formatting, lint-only rewrites, renames, reordered keys and unrelated files, except the root fix command's changes in the cleanup layer. Propose the default branch's code, with a lint downgrade or a reasoned disable where new rules would fail it.
- **Supersede:** features and versions that the final direction replaced, compatibility for versions nobody released, and capabilities that only a test or demo needed.
- **Simplify:** dead code, unused exports, duplicate logic, layered overrides, no-ops, workarounds and machinery that a smaller design avoids.
- **Keep:** what the intent needs, with the reason.

Read every hand-written hunk; a sample is not an audit. Judge generated output through its generator and a representative subset. List every cast, lint or type suppression, filename exemption and file-wide disable that the change adds: a simplify row with its typed alternative, or a keep row for an exception the engineering skill allows. Return one row per item with the path and lines, class, evidence, smallest change, size and what the change breaks.

## Critique

Challenge the outcome, the taste and the attempts so far, and do not defer to the author. Compare different mechanisms, including a smaller one. Test the strongest counterexample and the weakest assumption. Prefer a reversible combination when compatible strengths combine. Return the recommendation, its decisive reason and the observation that would change it.

## Body reader

Read the published pull request as a reviewer who knows nothing else. Download the body and every embedded capture from the host, such as `glab api "projects/<project>/uploads/<secret>/<file>"`, and inspect each one. Compare them with the head of the branch and the source tickets. Report a claim that a capture or the code contradicts, and a ticket requirement without proof. Report a capture that is unreadable, ends before its outcome, or shows loading when loading is not the claim. Report every departure from the [example body](../workflow/references/publishing.md#example-body). Return each finding with the section, the evidence and the smallest fix.
