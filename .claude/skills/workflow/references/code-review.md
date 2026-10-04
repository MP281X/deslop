# Code review

**Depth.** Trace contracts through real consumers, failures, concurrency and ownership against the merge base/criteria. Challenge the author's assumptions, not just syntax. Keep only introduced/exposed, reachable violations unhandled by surrounding code; decisive probes beat speculation.

**Return.** Return actionable findings or Clean. Each finding needs path:line, reachable input, actual/required outcome, consequence and smallest fix; identify missing proof and retain unaffected coverage.
