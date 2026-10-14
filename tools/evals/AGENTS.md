# Evaluations

This private CLI prepares skill evaluations and collects evidence. T3 runs the agents.

## Cases

Put `EVALS.md` beside the owning `SKILL.md`. Each level-two heading is a case id with `### Task` and `### Criteria`. The agent receives the task, not the criteria. Normal skill installation includes this file; evaluation preparation alone excludes it.

Cases contain no starter paths or install commands: the CLI copies the existing import package, installs frozen dependencies and seeds a separate Git repository. Testing receives the folder-import implementation; review receives a defective folder-import diff after the seed commit. The single-skill orchestration case evaluates the primary lifecycle only; delegation and live publishing remain disabled.

## Run

```bash
node tools/evals/src/main.cli.ts prepare <skill-directory>
node tools/evals/src/main.cli.ts record <directory> <run-id> <thread-id>
node tools/evals/src/main.cli.ts collect <directory>
node tools/evals/src/main.cli.ts cleanup <directory>
```

1. Preparation fully replaces the five managed global base files from this checkout without merging or backups, before creating isolated provider homes and repositories. It preserves sign-ins, sessions, existing skills and remembered approvals. Each runtime gets the base configuration and selected skill only.
2. With authorization for temporary evaluation threads, register `run.repo` using `t3_project_create`. Launch its project with `workspaceStrategy: {type: "root", branch: "main"}`, its provider instance, task and a high-effort cheap model. A child that inherits this checkout does not prove selected-skill isolation.
3. Record the thread id, wait for terminal status and collect. Check the native session's loaded configuration and skills. Give anonymous numbered `judge/` snapshots to the quality judge without identities or efficiency measurements; the user judges final artifacts.
4. After collection, delete owned projects through `t3_project_delete(force: true)`, which also deletes their threads. Verify deletion, then run cleanup to remove owned provider registrations and authentication links. Stop owned app-server and starter processes; keep evidence.

## Compare

Runner changes require real T3 isolation and collection proof. Reuse retained native runs for unchanged contracts; source checks and constructed transcripts do not prove T3 behavior.

- `report.json` retains native measurements for the full run and children. `evidence/` keeps transcripts, calls, results, artifacts, binary diffs and Git bundles; `judge/` keeps anonymous runnable snapshots and replies, including referenced browser captures.
- Missing or incomplete runs are not successes. Keep unknown first-pass readiness and corrective edits null until annotated; separate implementation defects, deliberate red tests and infrastructure failures.
- Claude input excludes separate cache reads and writes; Codex input includes cached input. Reasoning is part of output, not an extra cost. Tool times overlap; batched script text does not establish executed calls.
- Prepare from the approved base and vary one instruction element only in isolated candidates. Keep task, starter, harness and model fixed; repeat close or inconsistent pairs. Never apply an unapproved candidate globally.
- Judge quality separately from efficiency. Completion and a cheap-model win establish neither merge readiness nor stronger-model quality. The user defines acceptance before installing an eval-driven refinement; an explicit preference-change request supplies approval for that change.
