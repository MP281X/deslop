---
name: orchestrator
description: 'Load before starting any change to a repository (code, config or docs), before relying on an external package or reading a reference or outside repository, and when a brief arrives as a delegate.'
---

# Orchestrator

## Task

```mermaid
stateDiagram-v2
    [*] --> Discussing : request
    Discussing --> Discussing : question / answer
    Discussing --> Drafting : [evidence leaves one variant, Approval covers the change, main thread] / edit, commit
    Discussing --> Variants : [evidence leaves a taste, product or architecture choice open] / render each decision's variants beside Today
    Discussing --> Planned : [evidence leaves one variant, in a side chat or without Approval covering the change] / trace each claim to code read or run, show the plan
    Variants --> Variants : user steers or mixes variants / edit the data, render again by path
    Variants --> Planned : user picks variants / trace each claim to code read or run, show the plan
    Planned --> Discussing : user steers
    Planned --> Drafting : user approves [main thread] / edit, commit
    Planned --> [*] : user asks for a handoff [side chat] / send the plan and its picked variants to the main thread
    Drafting --> Drafting : user steers [inside the plan] / edit, commit
    Drafting --> Discussing : user steers [outside the plan]
    Drafting --> Validating : user calls the work settled / Validate
    Validating --> Validating : Validate [fails, the approach survives] / fix
    Validating --> Discussing : Validate [fails, the approach does not survive] / show the finding
    Validating --> [*] : Validate [passes] / push by the pull-requests skill, cleanup
```

- **Checks wait for settle.** While drafting, the fixer, checks, tests and pushes wait for Validate unless the user asks; a diagnosis still runs its reproducing probe, and a delegate the proof its brief names.
- **Variants.** Rough, made in minutes before any build: 2–3 you would build, differing in interaction model rather than styling, on the same data; a better idea than the user's is one of them.
- **UI.** [prototype.html](references/prototype.html), by its header. A pattern several screens share is approved on one realistic page showing all its states before it spreads.
- **Architecture.** Settle first, each from code, docs, tests or a probe where they answer it: what deploys alone and who owns which data; who may do what; which queries, volume and retention shape storage; where each piece of state lives, how long, and which copy is the source; whether a failure is a cancellation, a retry or the user's to act on, and where it is handled; which operating facts remove complexity. Each variant then shows, under its id, the format that leaves no ambiguity for its case (a traced value, a contract diff, a role-by-operation grid, sample rows before and after), never prose, with only the details that change the choice.
- **Untouched.** Every plan lists what stays untouched beside what changes.
- **Precedent.** Before an edit, read how the neighbouring feature or shared package does it.
- **Outside code.** A package's behaviour comes from its installed source, read rather than recalled; [Repositories](references/repos.md) only for what local precedent and installed source cannot answer.
- **One owner.** One main thread per worktree: check `t3_thread_list` first and give the user a live owner's link rather than starting a second.
- **Main.** Do small edits, prototypes and needed reads yourself, since a delegate costs a brief and a report on a thread that re-reads its context every call.

## Route

Delegates go to Codex unless the work needs Claude's judgement: the main thread runs on the Claude plan, the one to make last, and Codex persists until it reaches a result, good or bad.

| Work                                                                                                                                                         | Model                              | `target`                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------- | ----------------------------------------------------------- |
| Edits whose architecture is settled; browser and computer use, captures; deep reviews; unbounded exploration; long runs, since Codex's cache does not expire | GPT-6.1 Sol                        | `codex` / `gpt-6.1-sol`                                     |
| Bounded reads, searches, runs and checks                                                                                                                     | GPT-6.1 Terra                      | `codex` / `gpt-6.1-terra`                                   |
| UI code; removals, since Codex rejects `rm -f` and `rm -rf`                                                                                                  | Sonnet 5.5                         | `claudeAgent` / `claude-sonnet-5-5`                         |
| Work that cannot be scoped: an open UI or architecture                                                                                                       | Opus 5.5                           | `claudeAgent` / `claude-opus-5-5`                           |
| Advisors on a hard architectural decision, both in one turn                                                                                                  | Fable 5.2 and GPT-6.1 Sol at xhigh | `claudeAgent` / `claude-fable-5-2`, `codex` / `gpt-6.1-sol` |
| Never                                                                                                                                                        | Luna, Haiku                        |                                                             |

- **Other company.** A review or second opinion comes from the company that did not write or propose the work; advisors come from both.
- **Effort.** Medium (`effort` on Claude, `reasoningEffort` on Codex); high when the task needs it; never low, nor xhigh or above outside the advisor row.

## Delegation

```mermaid
stateDiagram-v2
    [*] --> Running : outcome briefed / delegate_task, siblings with disjoint files in one turn
    Running --> [*] : PASS or ISSUES [read-only brief] / use its findings and evidence
    Running --> [*] : PASS [edit brief, the result matches the decisions] / commit its shared-checkout diff
    Running --> Running : ISSUES, or PASS missing a decision [edit brief, first time] / t3_thread_send the child what the brief left out
    Running --> [*] : ISSUES, or PASS missing a decision [edit brief, again] / finish it in the main thread
    Running --> Running : BLOCKED [the main thread can clear it] / clear the blocker, t3_thread_send the child to continue
    Running --> [*] : BLOCKED [only the user can clear it] / put it to the user
    [*] --> PRThread : a separate PR must progress in parallel / delegate_task isolation 'worktree', a persistent thread
    PRThread --> PRThread : its next step / t3_thread_send
    PRThread --> [*] : its PR merged or closed / Cleanup
```

- **Shared checkout.** Delegates other than PR threads share the main thread's worktree and branch, so they never commit.
- **One outcome per delegate.** Coupled edits share one thread, since split halves come back for the main thread to reconcile. A procedure is a skill, not a child agent.

## Brief

About 1,500 characters: the delegate has the instructions, the skills and the checkout, not the thread. Give only the objective, the settled decisions, the approved render's path, the files it owns, what to leave alone, the narrowest command that proves it, when one does, and the report you want.

## Delegate run

A delegate runs its brief as the approved plan and edits only the brief's files.

```mermaid
stateDiagram-v2
    [*] --> Working : a brief or a later message arrives
    Working --> Working : the brief's proof [fails, edit brief] / fix
    Working --> [*] : work done [read-only brief] / report ISSUES with each finding or failed check, else PASS, with evidence
    Working --> [*] : work done [edit brief, proof passes or none named, shared checkout] / report PASS
    Working --> [*] : work done [edit brief, proof passes or none named, PR thread] / commit, then if the brief or a message has called the work settled, Validate and push by the pull-requests skill, report PASS
    Working --> [*] : cannot finish [a command's output proves the blocker] / report BLOCKED
    Working --> [*] : cannot finish [no proved blocker] / report ISSUES with what is done and what is missing
```

- **Report.** Short: its status word, then evidence (command, exit code, `path:line`, and a SHA only for a commit it made), not narration.
