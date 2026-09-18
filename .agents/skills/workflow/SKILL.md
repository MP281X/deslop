---
name: workflow
description: 'Use when changing the reusable agent workflow: global conduct, primary configuration, specialist roles, or the engineering skill.'
---

## Objective

The user converses with one agent that thinks with him: it brainstorms, pushes back, and turns a half-formed idea into the smallest verifiable scope. That agent then hands a complete assignment to cheaper specialists that do the work and return a result.

Two things are being protected:

| Protected            | Because                                                                              |
| -------------------- | ------------------------------------------------------------------------------------ |
| Primary's context    | It holds the conversation and the decisions; tool output and transcripts evict it    |
| Primary's token cost | It runs the expensive model; searching and reading there is the wrong place to do it |

Delegation is therefore an economic decision, not a division of labour: expensive tokens buy decisions, cheap tokens buy work. More delegation is better than less, as long as each assignment is one complete responsibility.

## Decisions

Settled. Do not re-open without new evidence.

| Decision                                                                                            | Why                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary uses no search, filesystem, shell, editing, or browser tool, including trivial lookups      | With tools it searches in the main thread, fails to find what it needs, spends 3-10 calls, and bloats context                                                                               |
| Primary loads no engineering or exploration skill                                                   | Skills describe how work is done; primary does not do work                                                                                                                                  |
| A specialist invokes the roles its own outcome depends on, and receives their results directly      | Routing results through primary turns it into a message box: one measured session spent 51M tokens on relayed messages                                                                      |
| Implementation owns its review and reruns affected proof after correcting it                        | Review needs the delta, which only the implementer has; primary-owned reviews cost 17x more for the same work                                                                               |
| Only implementation serializes, on write scope; explore, review, and browser run freely in parallel | Read-only work cannot conflict. Two implementers in one package or file corrupt each other's edits                                                                                          |
| Parallelism is across scopes, never inside one scope                                                | A review nested in its own scope costs minutes and blocks nothing                                                                                                                           |
| A continuation reuses the existing owner with a delta brief                                         | Restarting a fresh agent pays rediscovery: 60 sequential waves re-read the same policy and re-derived the same state                                                                        |
| No agent delegates to itself, to an ancestor, or without a bounded outcome                          | Endless delegation and cycles                                                                                                                                                               |
| Explore returns facts and unresolved uncertainty, never a plan or a recommendation                  | Design belongs in the conversation with the user                                                                                                                                            |
| A rule stays in `engineering` even when static analysis also enforces it                            | Enforcement is a fallback for a slip, is absent in some projects, and varies in strictness. Relying on it to produce good code is the same mistake as writing slop and leaving it to review |
| Implementation receives the assignment in the message, or as a spec file when it outlives one turn  | 58% of implementation assignments spanned several turns or a compaction, and a message does not survive compaction. For a single-turn assignment the file is pure overhead                  |
| Every assignment states an acceptance criterion as a command and its expected result                | Where the criterion is missing the agent invents one. That is where `zero warnings` came from, and ~60 waves after it                                                                       |
| A brief carries what the recipient would otherwise guess, and omits only what it can verify itself  | Compressing a brief to what is "inferable" makes the recipient fill the gap, and it fills it wrong                                                                                          |
| Agent scratch state lives under `~/.deslop/`, never in the repository                               | `repos/` holds reference clones, `specs/<objective>.md` the approved spec, `browser/<task>/` run artifacts. No repository noise, and it survives worktree removal                           |
| The spec accumulates settled facts, decisions, and explore findings                                 | A later wave, a review, or a handoff into a clean thread reads it instead of rediscovering. The spec is the handoff                                                                         |
| The stop condition is agreed with the user before dispatch, as a command and its result             | An agent with no stop condition invents one                                                                                                                                                 |
| A multi-wave campaign returns its first wave for review before the rest run                         | The failure is not slowness, it is hours of work delivered against a wrong premise                                                                                                          |
| A specialist completes end to end and returns once                                                  | Specialists sent 562 messages back to primary and 549 to each other in one session, on top of primary's 640. Each costs both sides a full turn                                              |
| An investigation is never repeated                                                                  | A fact in the brief or the spec is established. 49 explore threads produced findings that implementation then rediscovered itself                                                           |
| Git runs only on an explicit user request, never on initiative                                      | Publication is the user's decision. A read-only query needs no request; a batch containing one write does                                                                                   |
| Scope is the smallest complete MVP, checked with the user before broad application                  | Scope expansion plus unverified iteration produces hours of work built on a wrong premise                                                                                                   |

## Communication with the user

The user is an experienced developer who may not know the affected codebase. Prose is unverifiable, so it does not carry the claim: the artifact does.

- Show the artifact that makes a claim checkable, trimmed to what is being discussed. A signature when the signature is the subject; the two conflicting lines, not both files; a count when the count is the point.
- Give the reason a thing is good or bad, not only the label. State why an existing check exists before proposing to disable it.
- Before asking, confirm the question is real: verify that the two things actually conflict, that the constraint actually applies, and that a cheaper option was not missed.
- Every option carries its consequence and its cost. A question with no downside stated on any option is not ready.
- No introduction, no summary, no restated policy, no narration of activity.
- Diagrams do not render in the host. Use code blocks, tables, and file trees.

## Structure

- **Metadata:** context pointer and trigger only.
- **Form:** write policy as a leading word, a table row, or a command, never as a prose paragraph. Prose has to be interpreted, and interpretation is where assumptions enter; it also costs tokens on every request and delays startup. State the fact, then the reason.
- **Ownership:** one owner and one completion predicate per behavior. Universal conduct and communication belong in `AGENTS.md`; interpretation, design, and routing belong to primary; role method and output belong to that role; capability and limit belong in configuration; engineering owns code-quality decisions and is written so the code is right as it is written; static enforcement is the fallback that catches a slip. Prefer a configuration limit over an instruction when the harness can enforce it.
- **Dependents:** point to the owner without paraphrasing its policy.
- **References:** conditional depth lives in a reference, loaded when its condition applies.
- **Do not add:** new contracts, stages, artifacts, parallel policy, tutorials, planned cleanup, or verifier-owned implementation work.
- **Cleanup:** delete policy only when current evidence shows it is conflicting, duplicated, weaker, superseded, or inactive. Git preserves history.

## Editing this workflow

The reusable snapshot lives in this repository and is installed into the user's Codex home by the package CLI.

| Path                                        | Installed as                   | Owns                                                                |
| ------------------------------------------- | ------------------------------ | ------------------------------------------------------------------- |
| `tools/workflow/assets/AGENTS.md`           | `~/.codex/AGENTS.md`           | Global conduct and communication                                    |
| `tools/workflow/assets/codex/config.toml`   | `~/.codex/config.toml`         | Primary instructions, role registry, limits                         |
| `tools/workflow/assets/codex/agents/*.toml` | `~/.codex/agents/deslop/`      | One specialist role each                                            |
| `tools/workflow/assets/skills/engineering/` | `~/.codex/skills/engineering/` | Reusable engineering guidance                                       |
| `tools/workflow/src/main.ts`                | —                              | The installed path list; update it when adding or removing an asset |

This skill and `.agents/skills/project-engineering` are repository-scoped and are not installed.

`config.toml` is replaced wholesale on install, so any key the user needs locally belongs in the asset.

Apply and verify:

```sh
cd tools/workflow && vp run build
node dist/main.js               # or: node dist/main.js <codex-home>
```

A running session keeps the old snapshot; the change takes effect in a new session.

## Completion

Every affected behavior has one owner, one completion predicate, consistent dependents, and required proof.
