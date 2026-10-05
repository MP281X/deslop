# Code review

**Depth.** Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. A finding is a broken behavior or contract that input a real caller or source produces can reach, or a violation of workflow's Clean step or an engineering, design or `CODING_STANDARDS.md` rule; taste without a rule is not, and neither is input that code following the engineering skill and lint never produces; code handling such input is a cleanup finding. A deciding probe beats speculation.

**Exhaustive.** Find everything in one pass: read every changed line, probe the input classes the author's tests miss, and keep going after the first findings. A fix round reviews the diff since the last reviewed commit and its consumers, with every earlier finding, confirmed or rejected, in the brief, not the whole diff again; consumers are still traced against the merge base.

**Return.** Findings, or "Clean" with the scope covered. Each finding gives the path and line, the reaching input, actual and required outcome, consequence and smallest fix.
