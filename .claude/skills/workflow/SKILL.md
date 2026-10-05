---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Iterate fast until the user is satisfied, then make the branch merge-ready in one production pass. The primary agent owns implementation, checks and integration.

## Prototype

- **Read first.** Read the code you touch and its consumers, and reuse findings from named threads. An analysis request stays read-only.
- **Explore.** Where the direction is open, try the alternatives and surface the open questions now, so that no iteration is needed after the production pass.
- **Write well.** Engineering applies to prototype code too.
- **Skip what adds nothing yet.** No root fix or check runs, review rounds, pushes, pipeline watching or pull request updates. Run the focused check that answers the current question.
- **Show.** Present results as inspected screenshots, short video or the key excerpt in the thread.
- **Checkpoint.** Commit locally as often as useful, write scratch code in the repository and reset afterwards; reset only your own changes.
- **Ask little.** Ask only about unknowable goals, access, scope or open taste, and keep working meanwhile. After two failures, test a hypothesis that tells the causes apart.

A change request after a push re-enters this phase.

## Production

Start when the user is satisfied, or at once for a settled task.

- **Clean.** Remove everything iteration left behind: duplication, dead or superseded code and text, layered overrides, abandoned alternatives and no-ops. Recheck every touched file against engineering and design.
- **Encode.** Turn each recurring mistake into a type, lint rule, test or script; write guidance only for judgment calls.
- **Cover inputs.** Before review, list the reachable input classes of every parser, boundary and state transition the diff adds or changes, and cover them per testing's Branches rule. Reproduce each confirmed code finding before fixing it, per testing's Bugs rule.
- **Review.** Run the first [code review](references/code-review.md) round over the whole diff with one reviewer per lens the diff contains (code behavior with probes; instructions and docs against each other), split by area when one reviewer cannot read its share. Fix every finding you confirm, then run fix rounds until one is clean; a fix that rewords prose without changing a rule, claim or link needs no further round.
- **Prove.** Run the full checks testing selects and the UI journeys design requires.
- **Ship.** Squash the unpushed checkpoints, update from the default branch, rerun proof whose inputs changed, push and open or update the draft pull request per [publishing](references/checks.md#publishing). Missing proof blocks the push; other irreversible or outward actions need confirmation.
- **Clean up.** Stop what you started: services, processes, extra worktrees, exit nodes, sign-ins and scratch files; keep requested previews and useful evidence. Formatter and autofix rewrites are trusted, even outside the task; your own edits stay inside it.

## Delegate

Delegate independent work that saves more than briefing and joining cost. Work that would need coordination protocols stays with the primary or waits until its inputs stop changing.

| Task            | Worth it when                                                                  | Recommended model                                      | Procedure                                      |
| --------------- | ------------------------------------------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------- |
| Research        | A substantial, bounded investigation while the primary continues.              | GPT-6 Luna · medium                                    | [Research](references/research.md)             |
| Implementation  | Substantial, specified work with separate files and a real parallel benefit.   | Sonnet 5.5 · high; Opus 5.5 for consequential judgment | [Implementation](references/implementation.md) |
| Design critique | Independent judgment that can change the direction.                            | Opus 5.5 · high                                        | [Ideas](references/ideas.md)                   |
| Verification    | A substantial, long check on source that nobody is editing.                    | GPT-6 Luna · medium                                    | [Checks](references/checks.md)                 |
| Browser proof   | A substantial, independent user journey.                                       | GPT-6.1 Sol · high                                     | [Browser](references/browser.md)               |
| Code review     | Each production review round, or a concrete risk needing independent judgment. | GPT-6.1 Sol · high                                     | [Code review](references/code-review.md)       |

Models are recommendations: validate them against T3's live catalog and the user's budget, and inherit the primary model when one is unavailable.

- **Brief:** goal, done when, procedure, files it may and may not touch, decisive context with sources, what to return. Pair's language applies; model and options go in tool fields.
- **Steer:** message a running child only with a fact that changes its next action.
- **Join:** reconcile missing or failed criteria; reclaim a child's files only after its writers stop; give new rounds to fresh tasks with prior findings.

## Decisions

Repository contracts live in `CODING_STANDARDS.md`, folder decisions in its `AGENTS.md`, reusable guidance in its skill and machine facts in environment. Read the owner before working in its area, and update it in place when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts that change a future action.
