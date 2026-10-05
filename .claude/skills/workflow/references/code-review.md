# Code review

**Stance.** Assume the diff has defects and hunt them as an adversary. Try to break each change with the inputs, orderings, failures and concurrency its author did not test, and run a probe for each suspicion instead of reporting it as a possibility. The primary allows at most two rounds, so find everything now.

**Depth.** Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. A finding is a broken behavior or contract that input a real caller or source produces can reach, or a violation of workflow's Clean step or an engineering, design or `CODING_STANDARDS.md` rule; taste without a rule is not, and neither is input that code following the engineering skill and lint never produces; code handling such input is a cleanup finding.

**Value.** Report only findings whose fix changes something a user, caller or maintainer would notice. Leave out wording preferences, hypothetical inputs, restatements of an earlier finding and changes the branch did not make.

**Exhaustive.** Read every changed line, probe the input classes the author's tests miss, and keep going after the first findings. A second round reviews the fixes since the reviewed commit and their consumers, with every earlier finding, confirmed or rejected, in the brief, not the whole diff again; consumers are still traced against the merge base.

**Return.** Findings ranked by consequence, or "Clean" with the scope covered. Each finding gives the path and line, the reaching input, actual and required outcome, consequence, the probe that showed it and the smallest fix.

## Probes

Run a probe script with the repository's runtime through Vite+: `vp node <file>`, or `vp env exec bun <file>` in Bun repositories such as Dual. Node cannot strip types from TypeScript imported under `node_modules`, so integrated code goes through the app or test entrypoint. Keep probes in scratch and leave source unchanged.
