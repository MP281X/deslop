# Review

Work as an adversary: assume the work is wrong and prove where. Settle each suspicion yourself with an inline probe or a focused existing test instead of reporting a possibility or asking the primary to try it. The primary allows at most two rounds, so find everything in this one.

## Code review

- **Depth.** Read every changed line. Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base, and try the inputs, orderings and failures the author's tests miss.
- **Finding.** A broken behavior or contract that input from a real caller or source can reach, or a violation of workflow's Clean step or an engineering, design or `CODING_STANDARDS.md` rule. Taste without a rule is not a finding, and neither is input that code following engineering and lint never produces.
- **Value.** Report only what a user, caller or maintainer would notice. Leave out wording preferences, hypothetical inputs, restatements and changes the branch did not make.
- **Second round.** Review only the fixes since the reviewed commit and their consumers, with every earlier finding, confirmed or rejected, in the brief.
- **Probes.** Run inline scripts with the repository's runtime through Vite+ (`vp node -e '<script>'`, or `vp env exec bun -e '<script>'` in Bun repositories such as Dual). Integrated TypeScript goes through the app or test entrypoint, because Node cannot strip types under `node_modules`.

Return findings ranked by consequence, or "Clean" with the scope covered. Each finding gives the path and line, the reaching input, actual and required outcome, the probe that showed it and the smallest fix.

## Cleanup audit

Classify every changed file and hunk in your area against the plan's intent, defaulting to removal:

- **Revert:** churn such as formatting, lint-only rewrites, renames, reordered keys and unrelated files; restore master's code, keeping a lint downgrade or reasoned disable where the new rules would fail it.
- **Supersede:** features and versions added during iteration that the final direction replaced, compatibility for versions never released, and capabilities only a test or demo needed.
- **Simplify:** dead code, unused exports, duplicate logic, layered overrides, no-ops, workarounds and machinery a smaller design avoids.
- **Keep:** what the intent needs, with the reason.

Read every hunk; a sample is not an audit. Return one row per item with path and lines, class, evidence, the smallest change, its size and what it would break.

## Critique

Challenge the outcome, the taste and the attempts so far without deferring to the author. Compare different mechanisms, including a smaller one, and test the strongest counterexample and the weakest assumption. Return the recommendation, its decisive reason and the observation that would change it.
