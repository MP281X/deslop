---
name: workflow
description: Primary task coordination, ownership and delivery. Use for execution decisions or handoffs; delegated work uses only its assigned procedure.
---

# Workflow

Work toward the next result the user can observe, not toward a process milestone. The primary agent owns the implementation, routine checks, contracts and integration.

## Decide the next action

Apply known preferences and queued corrections. Read the code you will touch and its consumers, and read a reference only when it can change the next action. Reuse findings from named threads through T3. A request for analysis stays read-only. An obvious task needs no alternatives, specification or evaluation round.

Keep trials usable, trustworthy and safe for data and resources, then show them to the user as inspected screenshots or short videos in the thread before doing merge-readiness work. Start a preview the user can open only when the user asks for one. Keep what a trial taught you, not what it cost. Design owns UI trials; engineering and testing own the quality and proof of the implementation you keep.

Ask only about goals you cannot know, access, scope changes or a consequential question of taste that is still open. Keep doing independent work while you wait. Do not end a turn at a routine milestone, a passing check or a review checkpoint: continue through the remaining authorized work unless the user must decide, provide access or resolve a real blocker. When something fails twice, form a new hypothesis that can tell the causes apart instead of repeating an equivalent attempt; testing owns timeout and rerun judgment.

When the same mistake recurs across agents, passes or sessions, change the environment instead of adding another instruction: a type, lint rule, test, script or codebase convention that makes the mistake impossible or loud. Write a sentence of guidance only when the rule needs judgment, and include an example of the failure.

Keep durable decisions where their owner lives. Repository-wide contracts go in `CODING_STANDARDS.md`. Decisions and usage for a package or configuration folder go in its `README.md`, with its `AGENTS.md` pointing there. Reusable guidance goes in its skill, and machine facts go in environment. Read the owning brief when you work in that area, and update it when a decision or contract changes; do not add a tour of the source code or repeat global instructions. Do not create empty briefs or files inside `src` that only repeat policy. Use `node_modules/.cache/deslop/done-when.md` only when continuity needs the current constraints and gaps, never as another status ledger.

Preserve the reasoning that the implementation cannot show: consequential rationale, rejected alternatives with their reasons, explicit non-goals and relevant attempts with their observed outcomes. Record only what changes a future action, and add the condition that would reopen the decision when that helps. Replace superseded entries instead of appending an iteration diary, and never invent history or rationale from the current code.

## Delegate when it pays

Delegate only when independent work saves more than the cost of briefing, coordinating and joining it. Repetition alone is not a reason. There is no mandatory stage or model ladder.

| Task            | Benefit required                                                             | Recommended model                                      | Procedure                                      |
| --------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------ | ---------------------------------------------- |
| Research        | A substantial, bounded investigation while the primary continues.            | GPT-6 Luna · medium                                    | [Research](references/research.md)             |
| Implementation  | Substantial, specified work with separate files and a real parallel benefit. | Sonnet 5.5 · high; Opus 5.5 for consequential judgment | [Implementation](references/implementation.md) |
| Design critique | Independent judgment that can change the direction.                          | Opus 5.5 · high                                        | [Ideas](references/ideas.md)                   |
| Verification    | A substantial, long check on source that nobody is editing.                  | GPT-6 Luna · medium                                    | [Checks](references/checks.md)                 |
| Browser proof   | A substantial, independent user journey.                                     | GPT-6.1 Sol · high                                     | [Browser](references/browser.md)               |
| Code review     | A concrete correctness or contract risk that needs independent judgment.     | GPT-6.1 Sol · high                                     | [Code review](references/code-review.md)       |

These are recommendations, not mandatory routing or benchmark rankings. Check model IDs and options against T3's live catalog and the user's provider and budget constraints; inherit the primary model when a recommendation is unavailable. Use the standard service tier unless faster service justifies its extra usage. Change a recommendation when observed repair cost warrants it, not through a fixed escalation ladder.

Delegated work must be independent. If coordinating a child needs a protocol (gates, GO and PAUSE signals, acknowledgements, snapshots of files it must not touch), the work is not independent: do that part yourself, or start the child only after its inputs stop changing. Start a final check when the source is final, not before.

### Write the brief

A child starts with nothing but the brief, so write it for a capable engineer who has never seen this task. Use full sentences in plain language, following Pair's language rules. Cover these points, in this order, and skip any that do not apply:

1. **Goal:** the outcome the child must produce and why it matters.
2. **Done when:** the observable result or command outcome that ends the task.
3. **Procedure:** the reference to follow, linked by path.
4. **Files:** the files the child may change and the files it must not touch.
5. **Context:** decisive facts with their source paths or commits. Put context longer than a few sentences in a scratch file and link it instead of inlining it.
6. **Return:** what to report, such as findings with evidence, exact commands with exit codes, and gaps.

Keep the model and its options in the tool fields, not the brief. Send a follow-up message only when a fact changes what the receiver should do next, and write it in full sentences.

### Join the results

Join completion events and reconcile any criteria that are missing or failed. Keep the native task identities instead of a duplicate progress record. Use read-only V2 inspection only to fill a concrete diagnostic gap.

Do not reclaim a child's files until its writers stop or it acknowledges a targeted handoff; cancellation alone is not enough. Cancel tasks that a change has invalidated. Give a new assignment or review round to a fresh task with the prior findings, responses and unresolved objections; never reopen a completed child.

## Review until a pass is clean

When the user asks for repeated passes or for the code to be as good as possible, run fresh review rounds over the whole final diff. After fixing a round's findings, review again; stop when one full pass finds no actionable defect, or when consecutive passes find only nitpicks. Do not shrink the requested depth to save quota without telling the user. The final reply states how many passes ran, what each found, and what no pass covered.

## Finish the requested outcome

Follow testing's rules for when inputs are stable enough to prove and which checks the change affects; unrelated work may continue meanwhile. Apply engineering's cleanup and design's visual inspection to the work you keep. Stop the services you started that are no longer needed, remove settled drivers and retired files or directories that you own, and keep useful evidence and requested previews. Check for empty source directories left behind; keep scaffolding a tool requires only when you know its purpose, and never sweep files owned by others or dependency stores. Do not expand into unrelated improvements.

Keep exploration and iteration local until the user is satisfied with a consequential new direction, judged from the captures in the thread; a settled or obvious task needs no extra approval step, and no task waits for the user to open a preview. Then finish the cleanup of the kept work, the required behavior checks and any warranted review, and resolve the findings before publishing. Approval belongs to prototyping, before review: reaching the review step means the work is meant to ship, so when the review loop ends with its findings resolved and the required proof passing, push the current branch without asking. Missing required proof or a known defect blocks any push, even to a draft pull request; green CI is not permission to publish incomplete work. Do not claim perfection from a finite set of checks, and do not invent claims that would need irrelevant proof.

Batch accepted changes into one pass of verification, installation and publication. Before pushing the current branch, fetch and update it from the default branch and resolve conflicts; rerun the affected proof if its inputs changed. Pushing the current branch when it is ready is authorized; any other irreversible or outward action needs confirmation. Follow [publishing](references/checks.md#publishing), then stop when the requested outcome is proved.
