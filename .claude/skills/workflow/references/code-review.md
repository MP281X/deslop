# Code review

Trace changed behavior through real consumers against the merge base and current criteria. Keep a finding only when this diff introduces/exposes it, a reachable input violates the contract and surrounding code does not handle it; use a decisive probe over speculation.

**Result.** Findings first, ordered by consequence: priority and path:line, reachable input → actual/required outcome, consequence and smallest fix. No finding means Clean. Then a package/file reading order with the behavior or contract to inspect at each path; distinguish changed logic from moves. The pair publishes the map once, not raw findings or an execution diary. Focused follow-ups retain unaffected coverage.
