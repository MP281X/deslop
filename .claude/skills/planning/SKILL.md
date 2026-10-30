---
name: planning
description: Load at task start, when the user changes direction, before design choices or delegation.
---

# Planning

## Outcome

Keep one active contract: the user's goal, accepted choices, rejected directions and order. A steer updates it; an approval accepts the proposal actually shown. Side-note constraints apply immediately; extra work follows the main task. Discuss deliberate configuration reversals before making them.

Resolve consequential uncertainty early and define a checkable finish for open-ended work. Preserve the agreed scope and quality; choose the investigation and implementation strategy yourself. Reuse valid evidence across batches and compaction, carrying pending work and IDs; recover missing decisions from the thread rather than guessing.

For performance claims, compare the same workload and environment across repeated runs. Report representative timings and the resource costs relevant to the change.

For an open screen design, show distinct usable variants with `html_render`, including the fewest-concepts option, in the app's theme on realistic data. An agreed direction needs no new choice. Validate the built journey against the pick at the same viewport.

## Delivery

Implement, prove the actual journey, Verify, review and publish per pull-requests. Fix related findings in a batch and revalidate what changed. Process belongs in prose, not hooks, stamps or coordination machinery.

One complete independent review before the first push covers the unmerged PR set and accepted requirements at immutable base/head pairs. Use one reviewer unless distinct risks need different expertise. Triage findings yourself; fix kept P1, P2 and trivial P3 findings. Pre-existing defects stay separate. Follow-up reviews cover changed contracts, not another full search; repeated substantial findings call for rethinking the approach.

## Delegation

Use `delegate_task`. Delegate bounded independent work when it saves time or adds judgment. Give the question, user constraints, evidence and stopping condition, without your verdict; reviewers also need immutable revisions and "Load the review skill." Keep parent and child investigations disjoint.

**Models.** Match cost to the work; use the parent's provider by default and the other family for second opinions. The user's provider/model or quota steer persists until changed. These are starting choices, not capability limits.

| Work                                                 | Codex         | Claude Code        | Effort   |
| ---------------------------------------------------- | ------------- | ------------------ | -------- |
| Exploration, lookup, inventory, evidence collection  | `gpt-6-luna`  | `claude-haiku-5-5` | `medium` |
| Reasoning, architecture, difficult debugging, review | `gpt-6.1-sol` | `claude-opus-5-5`  | `high`   |

**Council.** When uncertain about an answer or approach, run an independent council automatically: `gpt-6-luna`, `claude-haiku-5-5`, `gpt-6.1-sol` and `claude-opus-5-5`, at their table efforts. Give each the same concise question, options, raw evidence and decision criteria, without your preferred answer or the other members' conclusions. Each returns tradeoffs, objections and its recommendation. Weigh the evidence and choose; do not vote or ask the user to settle a technical uncertainty. User-only product/taste choices and approvals remain theirs.

If working in `~/deslop`, hand off to a task worktree with `t3_worktree_handoff` before editing: that main checkout supplies every thread's installed configuration.
