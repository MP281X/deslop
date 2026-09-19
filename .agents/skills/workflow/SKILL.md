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

## Ownership

Policy is stated once, by the file that owns it. Everything else points here or stays silent.

| Owner                                       | Owns                                                                                               |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `tools/workflow/assets/AGENTS.md`           | Conduct every agent shares: behavior, delegation contract, communication, questions, scratch state |
| `tools/workflow/assets/codex/config.toml`   | Primary's capability, conversation, scope, dispatch mechanics, completion, and harness limits      |
| `tools/workflow/assets/codex/agents/*.toml` | One role's method, output, and completion predicate. Nothing another role also needs               |
| `tools/workflow/assets/skills/engineering/` | Code-quality decisions                                                                             |
| This skill                                  | Why the above is shaped as it is. It records decisions and evidence, never instructions            |

## Decisions

Settled. Do not re-open without new evidence.

| Decision                                                                                                    | Why                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Primary uses no search, filesystem, shell, editing, or browser tool, including trivial lookups              | With tools it searches in the main thread, fails to find what it needs, spends 3-10 calls, and bloats context                                                                                                                   |
| Primary loads no engineering or exploration skill                                                           | Skills describe how work is done; primary does not do work                                                                                                                                                                      |
| A specialist invokes the roles its own outcome depends on, and receives their results directly              | Routing results through primary turns it into a message box: one measured session spent 51M tokens on relayed messages                                                                                                          |
| Implementation owns its review and reruns affected proof after correcting it                                | Review needs the delta, which only the implementer has; primary-owned reviews cost 17x more for the same work                                                                                                                   |
| Implementation and git serialize on write scope; explorer, review, and browser run freely in parallel       | Read-only work cannot conflict. Two writers in one package or file corrupt each other's edits, and git writes the tree and its branches                                                                                         |
| Parallelism is across scopes, never inside one scope                                                        | A review nested in its own scope costs minutes and blocks nothing                                                                                                                                                               |
| A continuation reuses the existing owner with a delta brief                                                 | Restarting a fresh agent pays rediscovery: 60 sequential waves re-read the same policy and re-derived the same state                                                                                                            |
| No agent delegates to itself, to an ancestor, or without a bounded outcome                                  | Endless delegation and cycles                                                                                                                                                                                                   |
| Explorer returns facts and unresolved uncertainty, never a plan, preference, ranking, or estimate           | Design belongs in the conversation with the user. Explorer threads that recommended a design had that design executed verbatim, with the alternatives never priced                                                              |
| A rule stays in `engineering` even when static analysis also enforces it                                    | Enforcement is a fallback for a slip, is absent in some projects, and varies in strictness. Relying on it to produce good code is the same mistake as writing slop and leaving it to review                                     |
| Implementation receives the assignment in the message, or as a spec file when it outlives one turn          | 58% of implementation assignments spanned several turns or a compaction, and a message does not survive compaction. For a single-turn assignment the file is pure overhead                                                      |
| The first recipient of a brief that names a spec path creates the file; every role reads and updates it     | Primary has no tools, so it cannot be the writer. Leaving the owner unnamed produced specs written by whichever specialist happened to act first                                                                                |
| The delegator owns the expected result; the recipient that can run commands establishes the proving command | Where the criterion is missing the agent invents one, and `zero warnings` plus ~60 waves came from an invented one. Primary has no tools, so requiring it to name the command made the blindest role invent it                  |
| A brief carries what the recipient would otherwise guess, and omits only what it can verify itself          | Compressing a brief to what is "inferable" makes the recipient fill the gap, and it fills it wrong                                                                                                                              |
| Agent scratch state lives under `~/.deslop/`, never in the repository                                       | `repos/` holds reference clones, `specs/<worktree>/<objective>.md` the approved spec, `browser/<task>/` run artifacts. No repository noise, and it survives worktree removal                                                    |
| The spec accumulates settled facts, decisions, and explorer findings                                        | A later wave, a review, or a handoff into a clean thread reads it instead of rediscovering. The spec is the handoff                                                                                                             |
| A specialist completes end to end and returns once, and checkpoints only before it loses context            | Specialists sent 562 messages back to primary and 549 to each other in one session, on top of primary's 640. Each costs both sides a full turn. The one thing worse is 37 minutes of silence ending in nothing                  |
| An investigation is never repeated                                                                          | A fact in the brief or the spec is established. 49 explorer threads produced findings that implementation then rediscovered itself                                                                                              |
| Implementation owns probes and completes one on its verdict, not on a clean review                          | The question contract forbids offering a workaround against an untried root fix, and implementation is the only role that can run the probe. Its normal completion predicate demands a clean review, which no probe can produce |
| Git runs only on an explicit user request, never on initiative                                              | Publication is the user's decision. A read-only query needs no request; a batch containing one write does                                                                                                                       |
| Scope is the smallest complete MVP, checked with the user before broad application                          | Scope expansion plus unverified iteration produces hours of work built on a wrong premise                                                                                                                                       |
| A specialist uses only the toolchain the repository declares, and never edits a lockfile by hand            | One implementation ran `npm` in a repository that configures neither it nor its lockfile, symlinked a second checkout's dependencies, then hand-wrote lockfile entries when install hung                                        |

## Harness

Codex behavior that the instructions must account for, because it competes with them.

| Behavior                                                                                                  | Consequence                                                                                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The built-in `spawn_agent` description names generic `explorer` and `worker` subtasks                     | An unregistered name carries no role instructions and falls back to `default_subagent_model`. The investigation role is therefore named `explorer`, the name an agent already reaches for                                           |
| A child's result reaches primary with `trigger_turn = false`                                              | An idle primary is not woken. Across every measured primary thread, 73 of 73 inter-agent deliveries did not trigger a turn, so `wait_agent` cannot be disabled                                                                      |
| A wait returns as soon as any dispatched agent completes                                                  | A long timeout costs nothing when work finishes early, and a short one only buys a poll. The floor is 15 minutes                                                                                                                    |
| `fork_turns = "all"` inherits the parent's context, model, and reasoning effort, and rejects overrides    | A forked specialist is neither cheap nor independent. New assignments start with `fork_turns = "none"`                                                                                                                              |
| `service_tier = "priority"` is the Fast tier: 2x speed on Astra, 1.5x on Sol and Luna, at increased usage | Removed everywhere. Luna at low effort is already fast, and Astra is the one model whose usage must not be doubled                                                                                                                  |
| Concurrency, depth, compaction threshold, tool output size, and wait length are configuration             | Prefer a configuration limit over an instruction wherever the harness can enforce it                                                                                                                                                |
| `thread_unload_delay_secs` unloads an idle thread; waits run 15-60 minutes                                | At 300 the first specialist back was unloaded before its delta arrived, so the warm-owner rules never applied. Set to 3600, above the longest wait                                                                                  |
| `max_depth = 2` does not reject a deeper spawn                                                            | 13 threads ran at depth 3 under this config, 9 of them explorers spawned by a depth-2 review. The only observed spawn rejection is the concurrency cap, 361 times. Do not write a rule against a limit the harness does not enforce |
| `max_concurrent_threads_per_session = 6` fails the dispatch past the ceiling                              | One implementation owner holding a review and a browser is already three. The dispatch rules say what to shed instead of letting the cap surface as an error                                                                        |
| A role's `config_file` rejects unknown keys; `codex doctor` reports them as startup warnings              | `codex debug prompt-input` renders the model-visible prompt with no API call. Both are the cheap way to verify an asset edit before a session                                                                                       |
| The session context window is 258,400 tokens, below the 272K 2x-pricing threshold                         | `model_auto_compact_token_limit` is 240000, leaving room for one capped tool result before the window ends                                                                                                                          |
| The uninstalled-plugin catalogue costs ~11 KB of prompt floor per thread                                  | `include_apps_instructions` is off                                                                                                                                                                                                  |
| Skill roots are `$CODEX_HOME/skills`, its `.system` directory, and `<cwd>/.agents/skills`                 | Repository-scoped skills load without installation, which is why `project-engineering` and this skill are not in the install target list                                                                                            |
| The skills list cites files by a `r<n>/` root alias, expanded from a table in the same block              | Agents pasted the alias literally as a path in 97 September sessions, failing every read for two weeks. `AGENTS.md` states the expansion                                                                                            |
| A command still running after ~30 seconds returns control and must then be polled                         | Every poll is a full turn that resends the whole context. One measured day spent 121 minutes of wall clock and 24 of model time on 285 such polls                                                                                   |
| `AGENTS.md` reloads into a running thread; a role's instructions are fixed when its agent spawns          | A long-lived specialist keeps the contract it was born with, so a role change is only evidence in a fresh session                                                                                                                   |
| The host prompt requires a commentary update roughly every 60 seconds                                     | A rule forbidding progress messages is not enforced, it oscillates. Constrain what a progress line must contain instead                                                                                                             |
| Compaction keeps every instruction an agent received and discards its command output and conclusions      | An unrecorded finding is gone at that moment, which is what the spec exists to survive                                                                                                                                              |

## Structure

- **Metadata:** context pointer and trigger only.
- **Form:** write policy as a leading word, a table row, or a command, never as a prose paragraph. Prose has to be interpreted, and interpretation is where assumptions enter; it also costs tokens on every request and delays startup. State the fact, then the reason.
- **Ownership:** one owner and one completion predicate per behavior, per the table above. A dependent file points at the owner without paraphrasing its policy.
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

Install replaces each of those four targets outright, discarding local edits to them. The `agents/deslop` directory name is load-bearing: `config.toml` reaches every role through `./agents/deslop/<role>.toml`.

Apply a change with `vp run build` in `tools/workflow`, then run the built `deslop-workflow` CLI. It takes an optional Codex home, defaulting to `CODEX_HOME` and then `~/.codex`. Nothing verifies that the target list covers every asset: the CLI copies the four listed targets and exits zero regardless. Check the list by hand when adding or removing an asset.

This skill and `.agents/skills/project-engineering` are repository-scoped and are not installed.
