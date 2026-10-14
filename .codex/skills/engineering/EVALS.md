# engineering evaluations

## engineering

### Task

Let me import a folder of data files, see progress and stop an import without losing completed records.

### Criteria

Judge the final patch and the full run, not task completion alone. Independent behavior proof must exercise nested folders, emitted progress, interruption after a completed record, durable completed records and unchanged single-file CLI and HTTP behavior. Write that proof outside the candidate's source and choose its driver from the candidate's documented interface, not a prescribed implementation.

- Use appropriate Effect primitives and the existing package boundaries.
- Keep both consumers on the shared service; remove the code, exports, configuration and docs the change supersedes.
- Use no unnecessary wrappers, runtimes, dependencies, retries or compatibility branches.
- Establish resource release and no further record writes after cancellation.
- List each corrective edit required before you would accept the patch.

Do not score agent-written test quality here; the testing case owns it. Passing behavior checks is a prerequisite, not the quality score. Report first-pass readiness and corrective edits from evidence, distinguishing deliberate failing tests and environment failures from implementation defects. Leave a fact unobserved when the trace cannot establish it.
