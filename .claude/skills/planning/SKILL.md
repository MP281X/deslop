---
name: planning
description: Load at task start, when the user changes direction, before design choices or delegation.
---

# Planning

## Outcome

Keep one active contract: the user's goal, accepted choices, rejected directions and order. A steer updates it; an approval accepts the proposal actually shown. Side-note constraints apply at once; extra work follows the main task. Discuss a deliberate configuration reversal before making it.

Settle consequential uncertainty early and give open-ended work a checkable finish. Keep the agreed scope and quality; the investigation and implementation strategy are yours. Carry valid evidence, pending work and IDs across batches and compaction; recover a missing decision from the thread rather than guessing.

Performance claims compare the same workload and environment over repeated runs, with representative timings and the resource costs the change affects.

An open screen design gets distinct usable variants as `html_render` mocks, the fewest-concepts option among them, in the app's theme on realistic data. An agreed direction needs no new choice; validate the built journey against the pick at the same viewport.

## Delivery

Build → prove the actual journey → Verify → one review → draft push, per pull-requests. Fix related findings in one batch and revalidate what changed; each round is one push. Process lives in prose, not hooks, stamps or coordination machinery.

The one complete independent review before the first push covers the unmerged PR set and the accepted requirements at immutable base/head pairs, with one reviewer unless distinct risks need different expertise. Triage findings yourself: fix kept P1, P2 and trivial P3 findings, and keep pre-existing defects separate. Follow-up reviews cover the changed contracts only; repeated substantial findings mean the approach needs rethinking.

## Delegation

Delegate bounded, independent work when it saves time or adds judgment. Give the question, the user's constraints, the evidence and a stopping condition, without your verdict; a reviewer also gets immutable revisions and "Load the review skill." Keep parent and child investigations disjoint.

**Models.** Match cost to the work: the parent's provider by default, the other family for a second opinion. A model, provider or quota steer from the user holds until changed.

| Work                                                 | Codex         | Claude Code        | Effort   |
| ---------------------------------------------------- | ------------- | ------------------ | -------- |
| Exploration, lookup, inventory, evidence collection  | `gpt-6-luna`  | `claude-haiku-5-5` | `medium` |
| Reasoning, architecture, difficult debugging, review | `gpt-6.1-sol` | `claude-opus-5-5`  | `high`   |

**Council.** For a hard-to-reverse decision whose evidence is split, ask `gpt-6-luna`, `claude-haiku-5-5`, `gpt-6.1-sol` and `claude-opus-5-5` at their table efforts the same concise question, with the options, raw evidence and decision criteria but neither your preferred answer nor the other members' conclusions. Each returns tradeoffs, objections and a recommendation; weigh them and choose. Otherwise decide, or ask one reviewer. Product, taste and approvals stay the user's.

Work in `~/deslop` moves to a task worktree with `t3_worktree_handoff` before any edit: that checkout supplies every thread's installed configuration.
