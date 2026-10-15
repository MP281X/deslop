# Evaluations

This private CLI prepares skill evaluations and collects evidence. T3 runs the agents.

## Cases

Put `EVALS.md` beside the owning `SKILL.md`. Each level-two heading is a case id with `### Task` and `### Criteria`. The agent receives the task, not the criteria. Normal skill installation includes this file; evaluation preparation alone excludes it.

Cases contain no starter paths or install commands: the CLI copies the existing import package, installs frozen dependencies and seeds a separate Git repository. Testing receives the folder-import implementation; review receives a defective folder-import diff after the seed commit. The single-skill orchestration case evaluates the primary lifecycle only; delegation and live publishing remain disabled.

## Run

```bash
node tools/evals/src/main.cli.ts prepare <skill-directory>
node tools/evals/src/main.cli.ts activate <directory> <run-id>
node tools/evals/src/main.cli.ts record <directory> <run-id> <thread-id>
node tools/evals/src/main.cli.ts collect <directory>
node tools/evals/src/main.cli.ts cleanup-run <directory> <run-id>
node tools/evals/src/main.cli.ts cleanup <directory>
```

1. Preparation copies the five managed base files from this checkout directly into isolated provider homes and repositories. Never replace live global base files to evaluate a candidate. Each runtime gets the base configuration and selected skill only; authentication links and temporary T3 provider registrations preserve existing sign-ins, sessions, skills and approvals.
   Preparation registers no providers or authentication links. Activate only a run that will start now. Normalize the starter and injected review diff with Oxfmt and deterministic lint autofix before the agent analyzes it. Keep the same normalization in both candidates. Measure remaining lint errors and structural correction effort, not raw formatting differences.
2. With authorization for temporary evaluation threads, register `run.repo` using `t3_project_create`. Launch its project with `workspaceStrategy: {type: "root", branch: "main"}`, its Codex provider instance, task and a high-effort model with `serviceTier: default`. Do not launch Claude or fast-mode evaluations. A child that inherits this checkout does not prove selected-skill isolation. Record runs in the same manifest sequentially; wait for each write to finish.
3. Record the thread id, wait for terminal status and collect. Check the native session's loaded configuration and skills. Give anonymous numbered `judge/` snapshots to the quality judge without identities or efficiency measurements; the user judges final artifacts. Before deleting a run, verify that its native transcripts and metrics are retained. Mark missing usage or transcripts unknown, not zero; retain the available evidence and the gap before cleanup.
4. Always preserve required evidence, then automatically delete each finished evaluation project through `t3_project_delete(force: true)` and verify that its threads are gone. Run `cleanup-run` immediately to remove that run's provider and authentication link; do not wait for other cases. Verify both removals. Run `cleanup` when the whole evaluation ends, including failed, cancelled and superseded runs. Stop owned app-server and starter processes; keep evidence and preserve unrelated state.

## Compare

Runner changes require real T3 isolation and collection proof. Reuse retained native runs for unchanged contracts; source checks and constructed transcripts do not prove T3 behavior.

- **Corrections.** Derive each case from a correction the user made in a real thread: the task repeats his original request on the starter, and the criteria quote his correction. A candidate passes only when the corrected mistake does not recur. A case without a recorded correction does not rank instruction changes.
- **Pilot first.** Before activation, fix the question, representative task, candidate difference, quality criteria and observation that ends the comparison. Start with one representative task pair, not every skill, model or instruction variant. Judge correctness, architecture, useful proof and user-required revisions before token traffic. Expand only to resolve a named uncovered contract or an inconsistent observation; no automatic next round or model sweep.
- **Full workflow.** For lifecycle changes, use the complete skill set and one real journey: provisional prototype approval, early real trial, an affected-direction steer and completion. Keep single-skill diagnostics separate. Reuse the established baseline when its task, source, harness and model still match; a changed baseline needs a new pair. A shorter reply or cheaper run does not prove better results or fewer user revisions. Stop with an unresolved result when evidence cannot rank the candidates.

- `report.json` retains native measurements for the full run and children. `evidence/` keeps transcripts, calls, results, artifacts, binary diffs and Git bundles; `judge/` keeps anonymous runnable snapshots and replies, including referenced browser captures.
- Missing or incomplete runs are not successes. Keep unknown first-pass readiness and corrective edits null until annotated; separate implementation defects, deliberate red tests and infrastructure failures.
- Claude input excludes separate cache reads and writes; Codex input includes cached input. Reasoning is part of output, not an extra cost. Tool times overlap; batched script text does not establish executed calls.
- Prepare from the approved base and vary one instruction element only in isolated candidates. Keep task, starter, harness and model fixed; repeat close or inconsistent pairs. Never apply an unapproved candidate globally.
- Judge quality separately from efficiency. Completion and a cheap-model win establish neither merge readiness nor stronger-model quality. The user defines acceptance before installing an eval-driven refinement; an explicit preference-change request supplies approval for that change.
