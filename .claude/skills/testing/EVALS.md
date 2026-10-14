# testing evaluations

## testing

### Task

Make me confident that stopping a folder import keeps completed records and releases its resources.

### Criteria

This case supplies the folder-import implementation. Judge the agent's tests separately from engineering changes.

- Exercise observable persistence, streaming order, cancellation and resource ownership through real boundaries.
- Synchronize on progress or a controlled dependency, not arbitrary sleeps.
- Test the existing single-file contract and both consumers where the claim crosses them.
- Prove the tests fail when progress is emitted before the write and when a detached writer continues after cancellation; mutation trials run outside the candidate checkout.
- Cancel during an active file read through a controlled filesystem adapter and verify release. Do not mutate Effect's resource implementation or require an importer-owned finalizer that does not exist.
- Reject tests of private implementation details, fabricated successes and redundant assertions.
- Keep only distinct regression protection with a named wrong implementation and observable failure; do not reward new files or case count.
- Use inline probes and real browser evidence for one-off questions without turning each observation into a permanent test.

Report which defects each test detects and which remain uncovered. Do not reward test count or coverage percentage. Record merge readiness and effort separately.
