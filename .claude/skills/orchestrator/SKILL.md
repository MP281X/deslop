---
name: orchestrator
description: 'Load before starting any change to a repository (code, config or docs), before relying on an external package or reading a reference or outside repository, and when a brief arrives as a delegate.'
---

# Orchestrator

## Task

```mermaid
stateDiagram-v2
    [*] --> Discussing : request for a change
    [*] --> Drafting : a side chat hands over a plan the user approved [main thread] / edit, commit
    Discussing --> Drafting : [Approval covers it, nothing is left open, main thread] / edit, commit
    Discussing --> Planned : [otherwise] / settle, show the plan
    Planned --> Planned : user steers / revise, render again by path
    Planned --> Drafting : user approves [main thread] / edit, commit
    Planned --> [*] : user approves and asks for a handoff [side chat] / send the plan, its picks and its render's path to the main thread
    Drafting --> Drafting : user steers [inside the plan] / edit, commit
    Drafting --> Planned : user steers [outside the plan] / show the plan
    Drafting --> Validating : user calls the work settled / Validate
    Validating --> Planned : Validate [a failure the approach itself causes] / show it
    Validating --> [*] : Validate [passes] / push by the pull-requests skill, cleanup
```

- **Settle.** Before showing a plan, answer from code, docs, tests or a probe each point it touches, leaving the user only taste, product and business knowledge recorded nowhere:
  - what deploys alone, and which service owns which data;
  - who may do what;
  - the queries, volume and retention that shape storage;
  - each piece of state's owner, lifetime and source copy;
  - each failure: a cancellation, a retry or the user's to act on, and where it is handled;
  - the operating facts that remove complexity.
- **Plan.** What changes and what stays untouched, each claim traced to code read or run. An open choice shows 2–3 variants you would build, rough, on the same data, differing in interaction model or structure rather than styling, a better idea than the user's among them. Each takes the format that leaves no ambiguity: UI in [prototype.html](references/prototype.html), by its header; structure as a traced value, a contract diff, a role-by-operation grid or sample rows before and after; never prose.
- **Shared patterns** are approved on one realistic page showing all their states before they spread.
- **Approved render.** The build matches the picked variant's screens, labels, states and click paths; a difference it needs goes back to the user as a plan.
- **Checks wait for settle.** While drafting, the fixer, checks, tests and pushes wait for Validate unless the user asks; a diagnosis still runs its probe, and a delegate the proof its brief names.
- **Precedent.** Before an edit, read how the neighbouring feature or shared package does it. A package's behaviour comes from its installed source, read rather than recalled; [Repositories](references/repos.md) for what neither answers.
- **One owner.** One main thread per worktree: check `t3_thread_list` first and give the user a live owner's link rather than starting a second.
- **Yourself.** Small edits, prototypes and reads, since a delegate costs a brief and a report.

## Route

Delegates go to Codex unless the work needs Claude's judgement: the main thread runs on the Claude plan, the one to make last, and Codex persists until it reaches a result, good or bad.

| Work                                                                                                                                                                     | Model                             | `target`                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------- | ----------------------------------------------------------- |
| Edits whose architecture is settled; browser and computer use, captures; reviews of Claude's work; unbounded exploration; long runs, since Codex's cache does not expire | GPT-6.1 Sol                       | `codex` / `gpt-6.1-sol`                                     |
| Bounded reads, searches, runs and checks                                                                                                                                 | GPT-6.1 Terra                     | `codex` / `gpt-6.1-terra`                                   |
| UI code; removals, since Codex rejects `rm -f` and `rm -rf`                                                                                                              | Sonnet 5.5                        | `claudeAgent` / `claude-sonnet-5-5`                         |
| Work that cannot be scoped: an open UI or architecture                                                                                                                   | Opus 5.5                          | `claudeAgent` / `claude-opus-5-5`                           |
| Advisors on a hard architectural decision, both in one turn                                                                                                              | Fable 5.2 and GPT-6.1 Sol at high | `claudeAgent` / `claude-fable-5-2`, `codex` / `gpt-6.1-sol` |
| Never                                                                                                                                                                    | Luna, Haiku                       |                                                             |

- **Other company.** A review or second opinion comes from the company that did not write or propose the work.
- **Effort.** Medium (`effort` on Claude, `reasoningEffort` on Codex); high when the task needs it, and for advisors; never low, xhigh or above.

## Delegation

```mermaid
stateDiagram-v2
    [*] --> Running : brief / start it by the harness's tool choice, siblings with disjoint files in one turn
    Running --> [*] : PASS or ISSUES [read-only brief] / use its findings and evidence
    Running --> [*] : PASS [edit brief, matches the decisions] / commit its diff
    Running --> Running : ISSUES or a missed decision [edit brief, first time] / resume it with what the brief left out
    Running --> [*] : ISSUES or a missed decision [edit brief, again] / finish it yourself
    Running --> Running : BLOCKED [you can clear it] / clear it, resume
    Running --> [*] : BLOCKED [you cannot] / report it with the user's action
    [*] --> PRThread : a separate PR must progress in parallel / delegate_task with isolation 'worktree'
    PRThread --> PRThread : its next approved step / t3_thread_send
    PRThread --> [*] : its PR merges or closes / Cleanup
```

- **Shared checkout.** Delegates other than PR threads share the main thread's worktree and branch, so they never commit.
- **One outcome per delegate.** Coupled edits share one delegate. A procedure is a skill, not a child agent.
- **Brief.** About 1,500 characters, since the delegate has the instructions, skills and checkout but not the thread: the objective, the settled decisions, the approved render's path, the files it owns, what to leave alone, the narrowest command that proves it and the report you want.

## Delegate run

A delegate runs its brief as the approved plan and edits only its files.

```mermaid
stateDiagram-v2
    [*] --> Working : a brief or message
    Working --> Working : the brief's proof [fails, edit brief] / fix
    Working --> [*] : done [read-only brief] / report PASS, or ISSUES with each finding and failed check
    Working --> [*] : done [edit brief, its proof passed or none named, shared checkout] / report PASS
    Working --> [*] : done [edit brief, its proof passed or none named, PR thread] / commit, Validate and push by the pull-requests skill once the work is called settled, report PASS
    Working --> [*] : stuck / report BLOCKED with the output proving it, else ISSUES with what is done and missing
```

- **Report.** Its status word, then evidence: command, exit code, `path:line`, and a SHA only for a commit it made.
