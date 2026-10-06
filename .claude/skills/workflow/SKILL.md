---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Plan with the user and iterate until they are satisfied. Then make the branch merge-ready in one production pass. The primary agent writes all code and runs the shared checks, builds and test suites.

## Plan

Before anything longer than a short exchange, settle this table with the user:

| Field     | Content                                                                   |
| --------- | ------------------------------------------------------------------------- |
| Intent    | The outcome the user wants, in one or two lines                           |
| Ticket    | Every requirement of the source tickets and comments, each as one claim   |
| Decisions | Choices already made, including what does not change                      |
| Defaults  | How to decide later choices without asking                                |
| Size      | Expected files, children and rough time, with the smaller option first    |
| Done when | Observable criteria: behavior, proof, pull request state, nothing running |

Show the plan as a render that the user can scan in seconds. Write each planned behavior as a one-line claim that can be true or false, such as "a user can pin one file version". Give each claim one exhibit: a UI mockup, a state machine, a flow or a schema. Put each decision on the claim it changes, with your default marked. End with what does not change. The question card collects the answers. A default the user did not answer is not agreement.

Paste the source tickets into the plan, including follow-up comments, and split them into requirements. A requirement left out of scope goes under **Needs you**; never drop one silently. List every decision the work needs before it starts, not only the first ones. Then work from the plan without asking again. Every brief to a thread or child carries the table. A change request after a push, or a new direction during production, updates the plan and re-enters Prototype.

**The request is the scope.** A related improvement goes under **Needs you** as a follow-up, not into the branch. So does a defect in code the task does not otherwise change, and a capability that only a test needs. A question that would grow the scope states its size, with the smaller option first.

## Prototype

- **Read first.** Read the code you touch and its consumers, and reuse findings from named threads. An analysis request stays read-only.
- **Explore.** Where the direction is open, try the alternatives and raise open questions now. Then nothing needs iteration after the production pass. Engineering applies to prototype code too.
- **Skip production work.** Run no root checks or fixes, review rounds, pushes, pipeline watches or pull request updates. Run only the focused check that answers the current question.
- **Show.** Use inspected screenshots, short video, an inline render or the key excerpt. Compare design directions as inline renders side by side. Start a preview only when the user needs the real app.
- **Checkpoint.** Commit locally as often as useful. Remove scratch code before production, and reset only your own changes.
- **Ask little.** Ask only about unknowable goals, access, scope or open taste, and keep working meanwhile. After two failed attempts, test a hypothesis that tells the causes apart.

## Production

Start when the user is satisfied, or at once for a settled task.

- **Prune.** Iteration leaves work that the final direction does not need, so cleanup is aggressive and complete in one pass. Audit the whole branch against the plan's intent per the [cleanup audit](references/review.md#cleanup-audit). Split a large diff across parallel audit children by area. Present every candidate in one round, grouped as revert, supersede, simplify or keep. Give each its size and what its removal breaks, and default to removal. Apply removals the plan's defaults cover, and ask about the rest.
- **Clean.** Apply the approved removals. Run formatters and autofixes only on files the branch changes. Revert your own edits outside the task. Recheck every touched file against engineering and design.
- **Encode.** Turn each recurring mistake into a type, lint rule, test or script. Write guidance only for judgment calls.
- **Cover inputs.** List the reachable input classes of every parser, boundary and state transition the diff adds or changes. Cover them per testing's Branches rule, and reproduce each confirmed finding before you fix it.
- **Review.** Run one [review](references/review.md) round over the hand-written diff, with one reviewer for each lens it contains. The lenses are code behavior, and instructions and docs checked against each other. Split an area that one reviewer cannot read. Fix each confirmed finding with a test that fails first.
- **Second round.** Review the fixes again only when they change more than the finding named. After two rounds, bring the remaining findings to the user.
- **Prove.** Assume the default branch passes every check. Run the type and lint checks and the tests that cover the code you changed; skip tests of unchanged code. The pipeline runs the full suite after the final push. Audit every changed screen against design before recording, and fix what you find. Prove each ticket requirement with the outcome a user sees, per [PR captures](references/browser.md#pr-captures). Inspect every capture, and fix the UI issues it shows before the final push.
- **Ship.** Update from the default branch and rerun what the update affects. Squash the unpushed checkpoints and push once, after the code is final and reviewed. Open or update the draft pull request per Publishing, and link it to the thread at once. Record the video while that pipeline runs, then add it to the body; editing the body starts no pipeline. Every embedded capture comes from the final code; remove captures from earlier passes. Push again only to fix a pipeline failure. Failing local checks block the push, and other irreversible or outward actions need confirmation.
- **Body review.** After the body is published, run one [body reader](references/review.md#body-reader) over the published body and captures. Fix what it confirms before you report.
- **Recap.** Render a recap in the plan's claim form. Show each delivered behavior with its before → after exhibit and lines, the size split and the riskiest places to read. Put code in `diff` blocks below the render. Then watch the pull request and end the turn.
- **Alignment review.** Write the recap at the level of behavior and mechanism, not diffs. For each area, state what a user or caller can now do, how it works and where it lives, so the user can confirm alignment. When the user restates their understanding, mark each point correct, partly correct or wrong, correct it, and list what they missed.
- **Clean up.** Stop what you started as soon as nothing needs it: children, services, previews, watches, browser sessions, sign-ins, extra worktrees, exit nodes and scratch files. Keep useful evidence. Keep one preview per branch while the user uses it, and give a manual test script: the URL, the sign-in, what is set up, and five to eight steps with the expected result of each.

## Working

- **Wait, do not poll.** Wait for a long command with one command that exits when the job ends. Run it in the background when other work remains.
- **Wait for children.** Wait with one blocking `t3_thread_wait` on the child's thread, or end the turn and let T3's completion notice wake you. Read the result once. If a wait is interrupted, call it again.
- **Run checks safely.** Serialize checks that compete for resources or write shared outputs. Give servers a readiness probe. Take the exit status from the command you started, not from a log footer. Keep bulky logs in scratch, and never filter a failure away.
- **Validate once.** Each validation has one owner, the primary or the pipeline. Never rerun a command, or re-review code, whose inputs did not change, unless the code is strictly related to or superseded by a change.
- **Use dead time.** Writes stay serial in the primary, and everything else runs in parallel. While a build or a child runs, start the independent reads, reviews, video recording and pull request text. Schedule work that does not depend on or overlap other work at once.
- **Assume safely.** Make safe assumptions that save time, and skip work that cannot change the outcome.
- **Fix causes.** Do no workaround, duplicate work or repeated expensive step without a reason the result would differ. Use the repository's named scripts, and fix a script that keeps failing.
- **Phase notes.** When Prototype, Production review or Ship starts, post one line that says what remains. Native plan and todo tools add nothing.
- **Own thread.** Never change the calling thread's model or options, because that interrupts the running turn.

## Publishing

- **Body.** Copy the shape and budgets of the [example body](references/pr-body.md). Describe what the final branch changes and how to review it, not its history. Keep consequential risks, even in mechanical changes.
- **Changed.** List user-visible behavior as short bullets. Add a before → after table only for public or breaking contracts, linked to their lines: endpoints, schemas, CLI flags, configuration keys, migrations and exported APIs.
- **Review guide.** Add a table with one row per area in reading order: order, area, at most three linked files, and what to check. Describe each area by behavior and mechanism, not diffs. End with a row of mechanical files to skip, and the hand-written size per package with the command that reproduces generated output.
- **Proof.** Embed the inspected videos and screenshots, each captioned with the claim it proves. Leave out process and activity, such as reviews or checks that ran, started services, planned work, test tables and pass numbers.
- **Links.** GitHub uses `https://github.com/<owner>/<repo>/blob/<branch>/<path>#L<start>-L<end>`. GitLab uses `https://<host>/<project>/-/blob/<branch>/<path>#L<start>-<end>`.
- **Commands.** Pass bodies and comments as files. Attach an image as `--attach '<file>#<alt text>'` and a GitHub video as a bare `--attach '<file>'`. `glab` has no `--jq` option, so pipe its API output into `jq`. Check the published head, title, body and files against the branch.

```bash
gh pr edit --body-file <file> --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <file> --attach <file>
```

- **Wakes.** T3's watch wakes the thread for failed or completed checks, comments, reviews and conflicts. Handle the cause of each wake, and resolve actionable review findings. Read logs only of failed jobs.
- **No T3 watch.** Run one blocking command in the background under `timeout 2h`. If no run exists for the head, inspect the pipeline trigger instead of polling.

```bash
ID=$(gh run list --commit "$(git rev-parse HEAD)" --json databaseId -q '.[0].databaseId'); : "${ID:?No run for this commit}"
gh run watch "$ID" --exit-status --compact; STATUS=$?; [ $STATUS -eq 0 ] || gh run view "$ID" --log-failed; exit $STATUS
glab ci status --wait --compact
glab api "projects/<project>/pipelines/<pipeline id>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```

- **Baseline.** To compare with the default branch, commit a checkpoint and run `git restore --source=origin/<default branch> -- <paths>`. Run the check, then reset to the checkpoint. Reinstall after the restore and again after the reset when a manifest or lockfile changed. Create an extra worktree only when both versions must run at once, and remove it afterwards.

## Delegate

Delegate self-contained, read-only work when its result saves more than the brief and the join cost. Children read and run read-only commands, inline scripts and focused existing tests. They keep captures in their own scratch directory outside the repository. They never write tracked files or touch the primary's services. They settle their own questions this way instead of asking the primary. Run independent children in parallel and in the background. Delegation is one level deep.

| Task          | Worth it when                                                    | Model               | Procedure                          |
| ------------- | ---------------------------------------------------------------- | ------------------- | ---------------------------------- |
| Research      | A substantial, bounded investigation while the primary continues | GPT-6 Luna · medium | [Research](references/research.md) |
| Code review   | Each production review round, or a concrete risk                 | GPT-6.1 Sol · high  | [Review](references/review.md)     |
| Cleanup audit | Each area of a large diff during Prune                           | GPT-6.1 Sol · high  | [Review](references/review.md)     |
| Critique      | Independent judgment that can change the direction               | Opus 5.5 · high     | [Review](references/review.md)     |
| Browser proof | A substantial, independent user journey on a running host        | GPT-6.1 Sol · high  | [Browser](references/browser.md)   |
| Body reader   | Each published pull request body                                 | GPT-6.1 Sol · high  | [Review](references/review.md)     |

Check each model against T3's live catalog and the user's budget. Use the primary's model when one is unavailable.

- **Brief.** Include the plan, the complete scope, the procedure, decisive context with sources and what to return. Put the model and its options in tool fields.
- **Steer.** Message a running child only with a fact that changes its next action.
- **Join.** Reconcile missing or failed criteria. Give a new round to a fresh task with the prior findings.

## Decisions

`CODING_STANDARDS.md` holds repository contracts, a folder's `AGENTS.md` holds its decisions, and environment holds machine facts. Read the owner before you work in its area, and update it in place when a decision changes. Record only rationale that the code cannot show: rejected options, non-goals and failed attempts.
