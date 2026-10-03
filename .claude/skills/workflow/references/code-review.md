# Code review

**Depth.** Trace contracts through real consumers, failures, concurrency and ownership against the merge base/criteria. Challenge the author's assumptions, not just syntax. Keep only introduced/exposed, reachable violations unhandled by surrounding code; decisive probes beat speculation.

## Result

- **Verdict.** Findings by consequence, or Clean.
- **Findings.** Priority · path:line · reachable input → actual/required outcome · consequence · smallest fix.
- **Read first.** Package/file | Changed contract to inspect; distinguish logic from moves.
- **Coverage.** Missing decisive proof only. The pair publishes the reading map once, not raw findings/diary. Focused deltas retain unaffected review coverage.
