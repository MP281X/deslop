# Code review

Trace changed behavior through real consumers against the merge base and current criteria. Keep a finding only when this diff introduces/exposes it, a reachable input violates the contract and surrounding code does not handle it; use a decisive probe over speculation.

**Result.** Findings first, ordered by consequence: priority and path:line, reachable input → actual/required outcome, consequence and smallest fix. No finding means Clean. Then an Intent | Read-first source | Observed/missing proof tour for the pair to publish once. Focused follow-ups retain unaffected coverage; no speculative findings or execution diary.
