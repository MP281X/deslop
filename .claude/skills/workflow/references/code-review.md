# Code review

**Depth.** Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. A finding is a broken behavior or contract, or a violation of workflow's Clean step or an engineering, design or `CODING_STANDARDS.md` rule; taste without a rule is not. A deciding probe beats speculation.

**Return.** Findings, or "Clean" with the scope covered. Each finding gives the path and line, the reaching input, actual and required outcome, consequence and smallest fix.
