# Code review

**Depth.** Trace each contract through its real consumers, failure paths, concurrency and resource ownership against the merge base. Report only findings that count under workflow's review rule; a deciding probe beats speculation.

**Return.** Findings, or "Clean" with the scope covered. Each finding gives the path and line, the reaching input, actual and required outcome, consequence and smallest fix.
