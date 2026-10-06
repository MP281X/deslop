---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Plan with the user, iterate until they are satisfied, then make the branch merge-ready in one production pass. The primary agent writes all code and runs every check, build and test.

## Plan

Before anything longer than a short exchange, settle this table with the user and post it in the thread:

| Field     | Content                                                                   |
| --------- | ------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                           |
| Decisions | Choices already made, including what is out of scope                      |
| Defaults  | How to decide choices that come up later without asking                   |
| Size      | Expected files, children and rough time; the smaller option first         |
| Done when | Observable criteria: behavior, proof, pull request state, nothing running |

Then work from it autonomously. Every brief to a thread or child carries it. A change request after a push, or a new direction during production, updates the plan and re-enters Prototype.

**The request is the scope.** A related improvement, a defect in code the task does not otherwise change, or a capability only a test needs goes under **Needs you** as a follow-up, not into the branch.

## Prototype

- **Read first.** Read the code you touch and its consumers, and reuse findings from named threads. An analysis request stays read-only.
- **Explore.** Where the direction is open, try the alternatives and surface open questions now, so nothing needs iterating after the production pass. Engineering applies to prototype code too.
- **Skip production work.** No root checks, review rounds, pushes or pull request updates; run the focused check that answers the current question.
- **Show.** Inspected screenshots, short video, an inline render or the key excerpt. Compare design directions as inline renders side by side; start a preview only when the user needs the real app.
- **Checkpoint.** Commit locally as often as useful; reset only your own changes.
- **Ask little.** Ask only about unknowable goals, access, scope or open taste, and keep working meanwhile. After two failed attempts, test a hypothesis that tells the causes apart.

## Production

Start when the user is satisfied, or at once for a settled task.

- **Prune.** Iteration leaves work the final direction does not need, so cleanup is aggressive and complete in one pass. Audit the whole branch against the plan's intent with parallel [cleanup audit](references/review.md#cleanup-audit) children split by area. Present every candidate in one round, grouped as revert, supersede, simplify or keep, with sizes and what each removal breaks, defaulting to removal; the user should not need follow-up questions to find more. Apply what the user approves.
- **Clean.** Apply the approved removals. Run formatters and autofixes only on files the branch changes, and revert your own edits outside the task. Recheck every touched file against engineering and design.
- **Encode.** Turn each recurring mistake into a type, lint rule, test or script; write guidance only for judgment calls.
- **Cover inputs.** List the reachable input classes of every parser, boundary and state transition the diff adds or changes, and cover them per testing's Branches rule. Reproduce each confirmed finding before fixing it.
- **Review.** One [review](references/review.md) round over the whole diff, one reviewer per lens it contains (code behavior; instructions and docs against each other), split by area when one reviewer cannot read its share. Fix each confirmed finding with a test that fails first. Run a second round over the fixes only when they change more than the finding named; after two rounds, bring remaining findings to the user.
- **Prove.** Run the full checks testing selects once, before the push; after a later minor change, run only the focused check it affects and let the pipeline catch the rest. Record a video of every user-facing journey the branch changes, inspect it and attach it to the pull request.
- **Ship.** Update from the default branch and rerun what the update affects. Squash the unpushed checkpoints, push, and open or update the draft pull request per Publishing. Link it to the thread and watch it. Render a review map in the thread: the size split, the changed contracts, the riskiest places to read and how the changed parts connect. Missing proof blocks the push; other irreversible or outward actions need confirmation.
- **Clean up.** Stop what you started as soon as nothing needs it: children, services, previews, watches, browser sessions, extra worktrees, exit nodes and scratch processes. Keep one preview per branch, and only while the user uses it.

## Working

- **Wait, do not poll.** Wait for a long command with one command that exits when the job ends, in the background when other work remains. Wait for a child with one blocking `t3_thread_wait` on its thread, or end the turn and let T3's completion notice wake you; read its result once. If a wait is interrupted, call it again. Never tail logs or reread status in a loop.
- **Fix causes.** No workaround, duplicate work or repeated expensive step without a reason the result would differ. Prefer the repository's named scripts to ad hoc launchers.
- **Phase notes.** When Prototype, Production review or Ship starts, post one line saying what remains. Native plan and todo tools add nothing.
- **Own thread.** Never change the calling thread's model or options; it interrupts the running turn.

## Publishing

- **Body.** Pair's Structure, describing what the final branch changes and how to review it, not its history. **Changed** lists every changed public contract (endpoint, schema, CLI flag, configuration key, migration, exported API) as a before → after row linked to its lines. A collapsed **Review guide** ranks the riskiest places to read and splits the size into hand-written, generated, vendored and moved lines, naming the command that reproduces generated output. **Proof** embeds the inspected videos. Leave out process and activity: reviews or checks that ran, services started, work planned.
- **Links.** GitHub `https://github.com/<owner>/<repo>/blob/<branch>/<path>#L<start>-L<end>`; GitLab `https://<host>/<project>/-/blob/<branch>/<path>#L<start>-<end>`.
- **Commands.** Pass bodies as files: `gh pr edit --body-file <file> --attach '<file>#<alt text>'`, `glab mr update <number> --draft --description-file <file> --attach <file>`. `glab` has no `--jq`; pipe its API output into `jq`. Check the published head, title, body and files against the branch.
- **Pipeline.** Register T3's `watch_pull_request` and end the turn; on a wake, read only the failed jobs' logs. Without it, run one blocking command in the background under `timeout 2h` (`gh run watch <id> --exit-status` or `glab ci status --wait`).
- **Baseline.** To compare with the default branch, commit a checkpoint, `git restore --source=origin/<default branch> -- <paths>`, run the check, then reset; reinstall when a manifest or lockfile changed.

## Delegate

Delegate self-contained, read-only work whose result saves more than briefing and joining cost. Children read, run read-only commands, inline scripts and focused existing tests, and keep captures in their own scratch directory outside the repository; they never write tracked files or touch the primary's services. They settle their own questions this way instead of asking the primary. Run independent children in parallel and in the background. Delegation is one level deep.

| Task          | Worth it when                                                    | Model               | Procedure                          |
| ------------- | ---------------------------------------------------------------- | ------------------- | ---------------------------------- |
| Research      | A substantial, bounded investigation while the primary continues | GPT-6 Luna · medium | [Research](references/research.md) |
| Code review   | Each production review round, or a concrete risk                 | GPT-6.1 Sol · high  | [Review](references/review.md)     |
| Critique      | Independent judgment that can change the direction               | Opus 5.5 · high     | [Review](references/review.md)     |
| Browser proof | A substantial, independent user journey on a running host        | GPT-6.1 Sol · high  | [Browser](references/browser.md)   |

Validate models against T3's live catalog and inherit the primary model when one is unavailable.

- **Brief.** The plan, the complete scope to cover, the procedure, decisive context with sources and what to return. Model and options go in tool fields.
- **Steer.** Message a running child only with a fact that changes its next action.
- **Join.** Reconcile missing or failed criteria; a new round goes to a fresh task with the prior findings.

## Decisions

Repository contracts live in `CODING_STANDARDS.md`, folder decisions in its `AGENTS.md`, reusable guidance in its skill and machine facts in environment. Read the owner before working in its area and update it in place when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts.
