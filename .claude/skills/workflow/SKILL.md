---
name: workflow
description: 'Primary iteration and bounded delegated procedures.'
---

# Workflow

**Role.** Primary work uses the loop below. Delegated work uses only its assigned procedure and ownership; no second coordinator.

## Work

- **Discover.** Read relevant local standards, touched code, nearest implementations and consumers. Reuse previous findings and named threads; investigate only uncertainty that can change the next example.
- **Try.** Start the smallest real example. Compare materially different directions, including a smaller one; use focused tests to eliminate weak options. Select reversible technical choices and expand the winner without a stage-approval callback. Challenge its weakest assumption while a trial can change the choice; critique consequential designs independently. UI comparisons follow design. When the same failure repeats without changed evidence or a new discriminating hypothesis, do not rerun the command or spawn another equivalent task. Record the failure and next hypothesis in `done-when.md`; run the smallest probe that can distinguish causes or change approach. Preserve testing’s one isolated timeout rerun; a successful rerun closes that timeout investigation.
- **Ask.** Ask only for unknowable goals, unresolved taste, access, scope expansion, feature removal or changing agreed requirements. Show the relevant example first; batch self-contained cards. An unsure answer means clarify, not permission to act.
- **Steer.** Fold queued corrections into the task. A pivot retires invalidated code, tests, config and claims—not unaffected work. Keep moving on independent work while a user decision is pending.
- **Criteria.** Keep current requirements, quoted constraints, behavior → proof, exclusions and rulings in `node_modules/.cache/deslop/done-when.md`. Unknowns remain questions, not invented requirements or a frozen specification.
- **Quality.** Apply engineering to prototypes too. Fix touched bugs at their root and every in-scope instance; remove everything made obsolete. Leave unrelated code alone and report evidenced problems outside scope.

## Delegate

**Purpose.** The primary implements, including repetitive work, and runs routine verification. Delegate only a well-defined, substantial task that benefits from background or parallel execution, or independent exploration/review that can change a decision. Keep work in the primary when briefing, coordination and joining cost more than doing it directly. No mandatory delegation stage or token-spending target.

**Ownership.** Keep taste, contracts, first instances, shared inputs and integration. Do not edit or run fixes over a running child’s owned files. Take those files back only after its writers stop or an acknowledged handoff stops its writes there; a cancel request alone is not a handoff. Assign complete independent outcomes, not tiny operations. Narrow scope never means shallow analysis: test counterexamples, alternatives and downstream effects. One coherent review needs one reviewer; partition only distinct risk-bearing contracts.

Use this table to judge whether delegation has a concrete benefit, not to create mandatory stages. Implementation and routine verification stay with the primary by default. Choose any delegated model from the live catalog within the user’s provider/model constraints.

| Task                    | Delegate when                                                                                                                 | Procedure                                      |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Research                | A bounded uncertainty needs substantial independent investigation while the primary can continue.                             | [Research](references/research.md)             |
| Implementation          | A substantial, well-defined slice has disjoint ownership and can genuinely run in parallel; repetition alone is not a reason. | [Implementation](references/implementation.md) |
| Ideas / design critique | An independent perspective can change a consequential design decision.                                                        | [Ideas](references/ideas.md)                   |
| Checks / behavior       | A long-running, bounded verification can run in the background on stable inputs; do routine checks directly.                  | [Checks](references/checks.md)                 |
| Code review             | A concrete correctness or contract risk benefits from independent judgment, not another opinion on settled evidence.          | [Code review](references/code-review.md)       |
| Browser proof           | A substantial, isolated consumer journey can run independently while the primary continues other work.                        | [Browser](references/browser.md)               |

**Brief.** In plain language, give the outcome, assigned procedure, owned files/resources and write permissions, decisive context, required proof and stop condition. Use a short paragraph or bullets, not a mandatory form. Name the procedure instead of copying its instructions or result format. State relevant constraints once; omit unrelated subjects rather than listing them as exclusions. Do not compress words together, paste transcripts or prescribe a script where an outcome is enough. Use repository-relative paths; model/options belong to tool fields. In a new review round, retain the original contract, prior findings and responses, and unresolved objections.

**Messages.** Send only information that changes the receiver’s next action or resolves a needed decision. Lead with the action or decision, then new evidence and its consequence. Skip routine progress, unchanged reminders and already-acknowledged findings. Deliver requested verdicts, new blockers and stopped-writer handoffs; brevity must not hide missing proof. Automatic completion notices need joining, not extra reminders or a new assignment in the child.

**Join.** Retain identities; collect the result needed for the next decision while other work continues. Cancel invalidated tasks. Reconcile actual terminal evidence, including failed/missing criteria. Completed-child follow-up defect [#15004](https://github.com/pingdotgg/t3code/pull/15004) requires a fresh task for a new assignment; interrupt obsolete follow-up work.

## Finish

Authorized: current-branch pushes, draft PRs/comments and skill-directed machine actions. Inspect deletion targets; confirm other irreversible/outward actions. Work only in this worktree, its scratch and assigned machine targets.

1. Merge the fetched default branch into the working branch; reread and simplify touched files against the merge base. The final diff contains the current solution, no trial footprints.
2. Before final verification, record checked inputs, required artifact readiness and relevant writer handoffs in `done-when.md`. Run the required checks and review the whole diff on ready, stable inputs. Use an independent reviewer when a concrete risk warrants it; do not delegate routine checks or wording reviews by default. This is an execution checkpoint, not user approval. Keep writers off checked source, dependencies, configuration and imported build outputs until checks finish. Disjoint work may continue. A relevant edit closes the affected gate and invalidates only dependent proof; finish the repair, record the new snapshot and rerun affected criteria. Format-only changes skip code checks.
3. Prove behavior at the real public seam with available credentials. Use screenshots/short video for visible behavior; inspect actual media. Use a fresh agent for instruction proof only when the evaluation can resolve a consequential uncertainty, not for every wording change. Reuse unchanged checks. Every criterion needs its own observed pass; cleanup removes settled drivers, fixtures and owned services, preserving embedded media. Persistent previews are opt-in.
4. Commit once, push and update the draft PR from the whole branch. Publish one package/file reading map, following checks' publishing procedure; keep optional detail collapsed. Upload only media that adds information Markdown cannot convey; verify title/body and the host's complete file inventory against the local diff. Use T3’s app-owned PR watcher when available; otherwise delegate the blocking pipeline watch. Resolve every comment/review thread before delivery.

Before every later push, update the working branch from the default and refresh the whole-branch description. Recheck only the new delta; retain unaffected review coverage. Stop only for a decision genuinely belonging to the user, not a technical problem you can resolve.
