---
name: workflow
description: 'Primary iteration and bounded delegated procedures.'
---

# Workflow

**Role.** Primary work uses the loop below. Delegated work uses only its assigned procedure and ownership; no second coordinator.

## Work

- **Discover.** Read relevant local standards, touched code, nearest implementations and consumers. Reuse previous findings and named threads; investigate only uncertainty that can change the next example.
- **Try.** Start the smallest real example. Compare materially different directions, including a smaller one; use focused tests to eliminate weak options. Select reversible technical choices and expand the winner without a stage-approval callback. Challenge its weakest assumption while a trial can change the choice; critique consequential designs independently. UI comparisons follow design.
- **Ask.** Ask only for unknowable goals, unresolved taste, access, scope expansion, feature removal or changing agreed requirements. Show the relevant example first; batch self-contained cards. An unsure answer means clarify, not permission to act.
- **Steer.** Fold queued corrections into the task. A pivot retires invalidated code, tests, config and claims—not unaffected work. Keep moving on independent work while a user decision is pending.
- **Criteria.** Keep current requirements, quoted constraints, behavior → proof, exclusions and rulings in `node_modules/.cache/deslop/done-when.md`. Unknowns remain questions, not invented requirements or a frozen specification.
- **Quality.** Apply engineering to prototypes too. Fix touched bugs at their root and every in-scope instance; remove everything made obsolete. Leave unrelated code alone and report evidenced problems outside scope.

## Delegate

**Purpose.** Use Orchestrator V2 when independent work shortens delivery or challenges bias—not to spend/save tokens or satisfy a delegation quota. Optimize quota and user attention per mergeable PR, including repairs/reviews, not per completed task.

**Ownership.** Keep taste, contracts, first instances, shared inputs and integration. Assign complete independent outcomes, not tiny operations. Narrow scope never means shallow analysis: test counterexamples, alternatives and downstream effects. One coherent review needs one reviewer; partition only distinct risk-bearing contracts.

Use the live catalog and high effort. The primary model remains the user's choice; routing defaults are task-specific:

| Task                         | Model             | Procedure                                      |
| ---------------------------- | ----------------- | ---------------------------------------------- |
| Sources                      | GPT-6 Luna        | [Research](references/research.md)             |
| Mechanical implementation    | Claude Sonnet 5.5 | [Implementation](references/implementation.md) |
| Substantial implementation   | Claude Opus 5.5   | Implementation                                 |
| Ideas / design critique      | Claude Opus 5.5   | [Ideas](references/ideas.md)                   |
| Checks / behavior / pipeline | GPT-6 Luna        | [Checks](references/checks.md)                 |
| Code review                  | GPT-6.1 Sol       | [Code review](references/code-review.md)       |
| Browser / computer proof     | GPT-6.1 Sol       | [Browser](references/browser.md)               |
| Image assets                 | GPT-6.1 Sol       | repository design                              |

**Escalate.** Luna evidence gaps → Sol; Sonnet product-judgment gaps → Opus. Reuse decisive evidence. Defaults are practical, not universal rankings; change a route when observed repair cost warrants it.

**Brief.** Named procedure, missing question/contract, owned files/resources, write permissions, known evidence, observable stop and Done-when path. Use repository-relative paths; model/options belong to tool fields. No ambiguous scope, repeated cwd, copied workflow or recursive committee.

**Join.** Retain identities; collect the result needed for the next decision while other work continues. Cancel invalidated tasks. Reconcile actual terminal evidence, including failed/missing criteria. Completed-child follow-up defect [#15004](https://github.com/pingdotgg/t3code/pull/15004) requires a fresh task for a new assignment; interrupt obsolete follow-up work.

## Finish

Authorized: current-branch pushes, draft PRs/comments and skill-directed machine actions. Inspect deletion targets; confirm other irreversible/outward actions. Work only in this worktree, its scratch and assigned machine targets.

1. Merge the fetched default branch into the working branch; reread and simplify touched files against the merge base. The final diff contains the current solution, no trial footprints.
2. On stable inputs, delegate full Check and independent whole-diff Review in parallel. Format-only changes skip code checks. Fix validated findings together; rerun affected tests. A relevant edit invalidates affected evidence, not everything.
3. Delegate behavioral proof at the real public seam with available credentials. Use screenshots/short video for visible behavior and fresh agents for instructions; inspect actual media. Reuse unchanged checks. Every criterion needs its own observed pass; cleanup removes settled drivers, fixtures and owned services, preserving embedded media. Persistent previews are opt-in.
4. Commit once, push and update the draft PR from the whole branch. Publish one package/file reading map, following checks' publishing procedure; keep optional detail collapsed. Upload only media that adds information Markdown cannot convey; verify title/body and the host's complete file inventory against the local diff. Delegate the blocking pipeline watch; resolve every comment/review thread before delivery.

Before every later push, update the working branch from the default and refresh the whole-branch description. Recheck only the new delta; retain unaffected review coverage. Stop only for a decision genuinely belonging to the user, not a technical problem you can resolve.
