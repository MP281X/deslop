# Orchestrator evaluations

These cases and criteria are drafts for discussion with the user, not approved acceptance thresholds.

## orchestration

### Task

Let me import a folder of data files, see progress and stop without losing completed records. Finish with a change I can review locally, including its commit message, PR title, PR body and final reply. Do not publish it.

### Criteria

Judge the whole primary run and its final artifacts, not a written plan. The importer is an existing package with CLI, HTTP and browser consumers; the agent must discover its contracts from the repository.

- Reach the requested behavior and keep the existing single-file consumers working.
- Establish the claims through real boundaries before describing them as complete.
- Keep implementation, proof and cleanup in the required order; reuse evidence that remains valid.
- Remove superseded code and owned empty directories, and keep comments rare.
- Write review artifacts once; make no routine rereads, self-checks or artifact-review requests.
- Ask only for user-only gaps, keep intermediate narration silent and leave no owned process running.

Record tokens, tool calls, elapsed time, corrections and the edits the user requires before accepting the result. Judge these separately from code quality and test quality. The current single-skill runner disables delegation and live publishing: this case measures the primary lifecycle, not cross-skill orchestration, external review or host integration. Keep the integrated evaluation deferred until its contract is defined with the user.
