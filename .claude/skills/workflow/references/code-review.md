# Code review

**Depth.** Trace each contract through its real consumers, failure paths, concurrency and resource ownership, compared with the merge base and the task's criteria. Challenge the author's assumptions, not only the syntax. Keep only violations that the change introduced or exposed, that real input can reach and that the surrounding code does not already handle. A probe that decides the question beats speculation.

**Return.** Return actionable findings, or "Clean" with the scope you covered. Each finding needs the path and line, the input that reaches it, the actual and required outcome, the consequence and the smallest fix. Name proof that is missing, and say which areas you checked and found unaffected.
