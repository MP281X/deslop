---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Two phases: prototype until the user approves the direction, then finish until the work is merge-ready. The primary agent owns implementation, checks and integration.

## Prototype

- **Read first.** Apply queued corrections, read the code you will touch and its consumers, and reuse findings from named threads. An analysis request stays read-only.
- **Iterate fast.** Build the smallest real version, show it, adjust. Skip full reviews, full test runs and full lint here; run only what the current question needs.
- **Show, don't host.** Present UI as inspected screenshots or short video in the thread. Start a preview only when the user asks.
- **Checkpoint freely.** Commit locally before experiments, write scratch code in the repository, and reset to the checkpoint afterwards. Reset only your own changes.
- **Ask little.** Ask only about unknowable goals, access, scope or open taste, and keep working meanwhile. A passing check is not a stopping point.
- **Change hypotheses.** After two failures, test a hypothesis that tells the causes apart instead of retrying.

## Finish

Start once the user approves the prototype, or immediately for a settled task.

- **Clean.** Apply engineering and design to every touched file: remove duplication, dead or superseded code and text, needless layers and no-ops. Replace old rules and code; never add a layer that overrides them.
- **Encode.** Turn a recurring mistake into a type, lint rule, test or script; write guidance only for judgment calls.
- **Review.** Review the whole diff aggressively in fresh rounds; a finding counts when it breaks behavior or a contract, or violates engineering's cleanup rules. Fix and repeat until a full round finds nothing that counts; taste without a rule is not a finding.
- **Prove.** Run the full checks testing selects, and the UI journeys design requires.
- **Ship.** Squash the checkpoints, update from the default branch, rerun proof whose inputs changed, push and open or update the draft pull request per [publishing](references/checks.md#publishing). A known defect or missing proof blocks the push. Other irreversible or outward actions need confirmation.
- **Clean up.** Stop what you started: services, processes, temporary branches, exit nodes, sign-ins and scratch files. Keep requested previews and useful evidence. Formatter and autofix rewrites are trusted, even outside the task; your own edits stay inside it.

## Delegate

Delegate independent work that saves more than briefing and joining cost. Work that would need coordination protocols stays with the primary or waits until its inputs stop changing.

| Task            | Worth it when                                                                | Recommended model                                      | Procedure                                      |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Research        | A substantial, bounded investigation while the primary continues.            | GPT-6 Luna · medium                                    | [Research](references/research.md)             |
| Implementation  | Substantial, specified work with separate files and a real parallel benefit. | Sonnet 5.5 · high; Opus 5.5 for consequential judgment | [Implementation](references/implementation.md) |
| Design critique | Independent judgment that can change the direction.                          | Opus 5.5 · high                                        | [Ideas](references/ideas.md)                   |
| Verification    | A substantial, long check on source that nobody is editing.                  | GPT-6 Luna · medium                                    | [Checks](references/checks.md)                 |
| Browser proof   | A substantial, independent user journey.                                     | GPT-6.1 Sol · high                                     | [Browser](references/browser.md)               |
| Code review     | A concrete correctness or contract risk that needs independent judgment.     | GPT-6.1 Sol · high                                     | [Code review](references/code-review.md)       |

Models are recommendations: validate them against T3's live catalog and the user's budget, and inherit the primary model when one is unavailable.

- **Brief:** goal, done when, procedure, files it may and may not touch, decisive context with sources, what to return. Pair's language applies; model and options go in tool fields.
- **Steer:** message a running child only with a fact that changes its next action.
- **Join:** reconcile missing or failed criteria; reclaim a child's files only after its writers stop; give new rounds to fresh tasks with prior findings.

## Decisions

Repository contracts live in `CODING_STANDARDS.md`, folder decisions in its `AGENTS.md`, reusable guidance in its skill and machine facts in environment. Read the owner before working in its area, and update it in place when a decision changes. Record only rationale the code cannot show: rejected options, non-goals and failed attempts that change a future action.
