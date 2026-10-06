---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Iterate fast until the user is satisfied, then make the branch merge-ready in one production pass. The primary agent writes all code and owns checks and integration.

## Scope

- **Plan before work.** Before anything longer than a short exchange, settle with the user the intent, the decisions, defaults for choices that will come up later, and the done criteria. State them in the thread, then work from them autonomously without asking again; a brief to a thread or child carries them.
- **The request is the scope.** The branch holds what the user asked for. A related improvement, a defect in code the task does not otherwise change, or a capability that only a test needs goes under **Needs you** as a follow-up instead of into the branch.
- **Size before growth.** A question that would grow the scope states what it adds in files, rough time and children, and the smaller option comes first.

## Prototype

- **Read first.** Read the code you touch and its consumers, and reuse findings from named threads. An analysis request stays read-only.
- **Explore.** Where the direction is open, try the alternatives and surface the open questions now, so that no iteration is needed after the production pass.
- **Write well.** Engineering applies to prototype code too.
- **Skip what adds nothing yet.** No root fix or check runs, review rounds, pushes, pipeline watching or pull request updates. Run the focused check that answers the current question.
- **Show.** Present results as inspected screenshots, short video, an inline render or the key excerpt in the thread. Compare design directions and mockups as inline renders side by side; start a preview only when the user needs to use the real app.
- **Checkpoint.** Commit locally as often as useful, write scratch code in the repository and reset afterwards; reset only your own changes.
- **Ask little.** Ask only about unknowable goals, access, scope or open taste, and keep working meanwhile. After two failures, test a hypothesis that tells the causes apart.

A change request after a push, or a new direction during production, re-enters this phase.

## Production

Start when the user is satisfied, or at once for a settled task.

- **Clean.** Remove everything iteration left behind: duplication, dead or superseded code and text, layered overrides, abandoned alternatives and no-ops. Run formatters and autofixes only on the files the branch changes, and revert your own edits outside the task before committing. Recheck every touched file against engineering and design.
- **Encode.** Turn each recurring mistake into a type, lint rule, test or script; write guidance only for judgment calls.
- **Cover inputs.** Before review, list the reachable input classes of every parser, boundary and state transition the diff adds or changes, and cover them per testing's Branches rule. Reproduce each confirmed code finding before fixing it, per testing's Bugs rule.
- **Review.** Run one [code review](references/code-review.md) round over the whole diff with one reviewer per lens the diff contains (code behavior with probes; instructions and docs against each other), split by area when one reviewer cannot read its share. Fix every finding you confirm and verify each fix yourself with a test that fails first. Run a second round over the fixes only when they change behavior beyond the lines the finding named. After two rounds, bring any remaining finding to the user instead of starting a third.
- **Prove.** Run the full checks testing selects and the UI journeys design requires. Record a video of every user-facing journey the branch changes working end to end, inspect it, and attach it to the pull request; a change with no user-facing journey shows its behavior through the checks instead.
- **Ship.** Squash the unpushed checkpoints, update from the default branch, rerun proof whose inputs changed, push and open or update the draft pull request per [publishing](references/checks.md#publishing). Render a review map in the thread: the size split, the changed contracts, the riskiest places to read and how the changed parts connect. Missing proof blocks the push; other irreversible or outward actions need confirmation.
- **Clean up.** Stop what you started: services, processes, extra worktrees, exit nodes, sign-ins and scratch files; keep useful evidence. A requested preview follows [Browser](references/browser.md#proof-and-previews): one per branch, stopped when the user is done with it.

## Working

- **Named scripts.** Prefer the repository's named scripts to ad hoc launchers, and fix the script when it keeps failing.
- **Wait, do not poll.** Wait for a long job with one command that exits when the job ends, in the background when other work remains. Do not tail logs or reread status files in a loop.
- **Phase line.** When Prototype, Production review or Ship starts, post one line that says what remains. Post nothing else about progress; T3 shows it, and native plan or todo tools add nothing.
- **Own thread.** Never change the calling thread's model or options; doing so interrupts the running turn.
- **Fix causes.** No workaround, duplicate work, or repeat of an expensive step without a reason the result would differ; fix the cause or ask.
- **Rerun what a change affects.** After a minor change, run only the focused check it can affect; the full checks run once before the push, and the watched pipeline catches the rest.
- **Close as you go.** Stop children, services, previews, watches and browser sessions as soon as nothing needs them.

## Delegate

The primary does every write. Delegate self-contained, read-only work whose result saves more than briefing and joining cost: unbiased analysis, exploration, research, critique, review and browser proof. The primary runs checks, builds and tests itself, because they write shared outputs. Children write nothing tracked in the repository and never touch the primary's services; they read, run read-only commands, inline scripts and focused existing tests, and keep captures in their own scratch directory outside the repository. A child settles its own questions this way and never asks the primary to write a test, run a check or answer something it can find out. Because they cannot collide, run independent children in parallel and in the background while the primary works. Delegation is one level deep.

| Task            | Worth it when                                                                  | Recommended model   | Procedure                                |
| --------------- | ------------------------------------------------------------------------------ | ------------------- | ---------------------------------------- |
| Research        | A substantial, bounded investigation while the primary continues.              | GPT-6 Luna · medium | [Research](references/research.md)       |
| Design critique | Independent judgment that can change the direction.                            | Opus 5.5 · high     | [Ideas](references/ideas.md)             |
| Browser proof   | A substantial, independent user journey.                                       | GPT-6.1 Sol · high  | [Browser](references/browser.md)         |
| Code review     | Each production review round, or a concrete risk needing independent judgment. | GPT-6.1 Sol · high  | [Code review](references/code-review.md) |

Models are recommendations: validate them against T3's live catalog and the user's budget, and inherit the primary model when one is unavailable.

- **Brief:** goal, the complete scope to cover, done when, procedure, decisive context with sources, what to return. Pair's language applies; model and options go in tool fields.
- **Steer:** message a running child only with a fact that changes its next action.
- **Join:** reconcile missing or failed criteria; give new rounds to fresh tasks with prior findings.

## Decisions

Repository contracts live in `CODING_STANDARDS.md`, folder decisions in its `AGENTS.md`, reusable guidance in its skill and machine facts in environment. Read the owner before working in its area, and update it in place when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts that change a future action.
