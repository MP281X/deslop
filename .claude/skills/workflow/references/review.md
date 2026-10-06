# Review

This work is read-only. Propose changes; never edit tracked files, and leave running services alone. Work as an adversary: assume the work is wrong and prove where. Settle each suspicion yourself with an inline probe or a focused existing test. Do not report a mere possibility or ask the primary to try it. The primary allows at most two rounds, so find everything in this one.

## Code review

- **Depth.** Read every hand-written changed line. For generated output, review the generator change and a representative subset, such as one package per source format. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. Try the inputs, orderings and failures that the author's tests miss.
- **Findings.** Report broken behavior or contracts that input from a real caller can reach. Also report violations of workflow's Clean step and of engineering, design or `CODING_STANDARDS.md` rules.
- **Not findings.** Taste without a rule is not a finding. Code that handles input which engineering and lint never allow is a cleanup finding, not a defect.
- **Value.** Report only what a user, caller or maintainer would notice. Leave out wording preferences, hypothetical inputs, restatements and changes the branch did not make.
- **Second round.** Review only the fixes since the reviewed commit and their consumers. The brief lists every earlier finding, confirmed or rejected.
- **Probes.** Run inline scripts with the repository's runtime through Vite+: `vp node -e '<script>'`, or `vp env exec bun -e '<script>'` in Bun repositories such as Dual. Node cannot strip types under `node_modules`, so integrated TypeScript runs through the app or test entrypoint.

Return the findings ranked by consequence, or "Clean" with the scope you covered. Each finding gives the path and line, the reaching input, and the actual and required outcome. It also gives the consequence, the probe that showed it and the smallest fix.

## Cleanup audit

Classify every changed file and hunk in your area against the plan's intent, and default to removal:

- **Revert:** churn such as formatting, lint-only rewrites, renames, reordered keys and unrelated files. Propose the default branch's code, with a lint downgrade or a reasoned disable where new rules would fail it.
- **Supersede:** features and versions that the final direction replaced, compatibility for versions nobody released, and capabilities that only a test or demo needed.
- **Simplify:** dead code, unused exports, duplicate logic, layered overrides, no-ops, workarounds and machinery that a smaller design avoids.
- **Keep:** what the intent needs, with the reason.

Read every hand-written hunk; a sample is not an audit. Judge generated output through its generator and a representative subset. Return one row per item with the path and lines, class, evidence, smallest change, size and what the change breaks.

## Critique

Challenge the outcome, the taste and the attempts so far, and do not defer to the author. Compare different mechanisms, including a smaller one. Test the strongest counterexample and the weakest assumption. Prefer a reversible combination when compatible strengths combine. Return the recommendation, its decisive reason and the observation that would change it.

## Body reader

Read the published pull request as a reviewer who knows nothing else. Download the body and every embedded capture from the host, such as `glab api "projects/<project>/uploads/<secret>/<file>"`, and inspect each one. Compare them with the head of the branch and the source tickets. Report:

- a claim that a capture or the code contradicts, including a capture of UI the head no longer has;
- a ticket requirement without proof, or one missing from the Ticket table;
- a capture whose text is unreadable at the body's width, that shows loading, or that ends before the outcome;
- a section over the [example body](pr-body.md)'s budget, process words, and facts placed under Needs you.

Return each finding with the section, the evidence and the smallest fix.
