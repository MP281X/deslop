---
name: explore
description: Use before reading anything beyond the files you will edit, their consumers and the canonical example, for a question that needs no change, a comparison of approaches, dependencies or reference repositories, research before a change, a delegated research brief, and any question about earlier threads.
---

# Explore

- **Decision first.** Name the decision and the observation that settles it; stop when the evidence settles it. Look for the counterexample, not more support.
- **Existing first.** Lead with what the codebase and its dependencies already do for the same job. Before any hand-written type, table, guard, wrapper, store or protocol, list the owning module's exports in its source checkout and read the closest ones, then how the study repositories below use them; a helper found this way replaces the code:

  ```bash
  rg -on '^export (const|function|class|interface) \w*(Literal|Tagged|Union)\w*' /tmp/repos/effect-4.0.5/packages/effect/src/Schema.ts
  # → Literal Literals TaggedStruct TaggedUnion Union toTaggedUnion …
  # read each: Literals has pick and transform; TaggedUnion has cases, guards and match
  ```

- **Sources.** Raw material over summaries: code, logs, rows and traces over docs and memory, a probe over reading; settle behavior with an inline script per engineering's Proof. Reproduce a stated belief from raw data before you build on it. Search by the domain concept, not only the request's words. A failed search is not a finding. When you count, define and list the members.
- **Answer** first, then only the deciding evidence with paths and lines; mark measured facts apart from inference.

## Source checkouts

Read a dependency in a checkout of its official repository at the version the lockfile holds, never in `node_modules`. Reuse a matching checkout under `/tmp/repos/` after checking its remote and commit; never build or change a shared one.

| Dependency                                                                 | Repository                                 | Tag                                            |
| -------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------- |
| Effect and `@effect/*`: platform, vitest, atom-react, sql, ai, `packages/` | https://github.com/Effect-TS/effect        | `effect@<version>`, `@effect/<name>@<version>` |
| Vite+: `vp`, Vite, Vitest, packing                                         | https://github.com/voidzero-dev/vite-plus  | `v<version>`                                   |
| TanStack Router and Start                                                  | https://github.com/TanStack/router         | `@tanstack/<package>@<version>`                |
| Expo and `@expo/ui`                                                        | https://github.com/expo/expo               | `expo@<version>`, `@expo/ui@<version>`         |
| Better Auth                                                                | https://github.com/better-auth/better-auth | `v<version>`                                   |

```bash
git clone --depth 1 --branch effect@4.0.5 https://github.com/Effect-TS/effect /tmp/repos/effect-4.0.5
```

For a shape the repository has no canonical example for, read how these codebases build it, at their default branch, before you invent one. Clone with `git clone --depth 1` into `/tmp/repos/<name>` and read the named directories first:

| Study                                                                   | Repository and directories                                                                                                                                                      |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Effect end to end, speed, web UI/UX, React Native app, schemas over RPC | [T3 Code](https://github.com/pingdotgg/t3code): `apps/web/src` (`state`, `rpc`, `components`), `apps/server/src`, `apps/mobile/src`, `packages/contracts/src`, `.agents/skills` |
| Agents, tool execution, sandboxed runtimes, generative UI, Effect atoms | [Executor](https://github.com/UsefulSoftwareCo/executor): `packages/kernel`, `packages/core/execution`, `packages/react/src`, `apps/cli/src`, `.agents/skills/wrdn-effect-*`    |
| Package organization, AI providers, CLI and TUI                         | [OpenCode](https://github.com/anomalyco/opencode): `packages/ai/src`, `packages/core/src`, `packages/cli/src`                                                                   |
| Effect's own idioms and tests                                           | [Effect](https://github.com/Effect-TS/effect): `packages/effect/src`, `packages/*/test`                                                                                         |
| Local-first sync and optimistic writes                                  | [Electric](https://github.com/electric-sql/electric): `examples/agents-chat-starter/src`                                                                                        |
| Streaming generative UI in React                                        | [AI SDK](https://github.com/vercel/ai): `packages/react/src`                                                                                                                    |

## T3 history

Search with `t3_thread_search` first. Each worker stores only its own threads: query both, the other through `ssh mp281x@<worker>`. Use `sqlite3 -readonly ~/.t3/userdata/statev2.sqlite`, selecting only needed fields; current records are in `orchestration_v2_projection_*` (`_threads`, `_messages`, `_turn_items`, `_runs`, `_subagents`). Native transcripts with every tool call: `~/.claude/projects/*/*.jsonl`, `~/.codex/sessions/**`. Analyze the full run with its children and the user's corrections.
