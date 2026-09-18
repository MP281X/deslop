## Sources

Installed source and types define library behavior. Clone upstream only when the installed copy cannot answer the question.

| Name              | Repository                  | Holds                                                   |
| ----------------- | --------------------------- | ------------------------------------------------------- |
| `effect`          | `Effect-TS/effect`          | Effect v4 implementation and exemplar code              |
| `effect-tsgo`     | `Effect-TS/tsgo`            | Effect TypeScript diagnostics and Oxlint integration    |
| `typescript`      | `microsoft/TypeScript`      | Compiler and type system                                |
| `react`           | `facebook/react`            | React 19, React DOM, hooks, React Compiler              |
| `base-ui`         | `MUI/base-ui`               | Base UI implementation                                  |
| `legend-list`     | `LegendApp/legend-list`     | Legend List implementation                              |
| `lexical`         | `facebook/lexical`          | Lexical editor and React integration                    |
| `tanstack-form`   | `TanStack/form`             | TanStack Form and React integration                     |
| `tanstack-hotkey` | `TanStack/hotkeys`          | TanStack Hotkeys and React integration                  |
| `tanstack-router` | `TanStack/router`           | TanStack Router, generator, and plugin                  |
| `oxc`             | `oxc-project/oxc`           | Oxc and Oxlint implementation and rules                 |
| `react-doctor`    | `millionco/react-doctor`    | React Doctor implementation and rules                   |
| `fallow`          | `fallow-rs/fallow`          | Fallow implementation and configuration                 |
| `vite-plus`       | `voidzero-dev/vite-plus`    | Vite+ implementation, commands, and configuration       |
| `codex`           | `openai/codex`              | Codex CLI, agents, skills, configuration, orchestration |
| `t3code`          | `pingdotgg/t3code`          | Exemplar Effect application architecture                |
| `executor`        | `UsefulSoftwareCo/executor` | Exemplar Effect application architecture                |
| `pi`              | `earendil-works/pi`         | Pi agent core and AI packages                           |
| `pierre-diffs`    | `pierrecomputer/pierre`     | Pierre diffs implementation                             |

## Checkouts

Clones live in `~/.deslop/repos/<name>`. Run these exactly: a full clone downloads years of history and every branch to answer a question that one commit answers.

```sh
# latest default branch, single commit
git clone --depth 1 --single-branch https://github.com/Effect-TS/effect.git ~/.deslop/repos/effect

# update an existing checkout
git -C ~/.deslop/repos/effect fetch --depth 1 origin HEAD
git -C ~/.deslop/repos/effect checkout --detach FETCH_HEAD

# a pinned <revision> from installed metadata or the lockfile instead of latest
git clone --filter=blob:none --no-checkout https://github.com/<owner>/<repo>.git ~/.deslop/repos/<name>
git -C ~/.deslop/repos/<name> fetch --depth 1 origin <revision>
git -C ~/.deslop/repos/<name> checkout --detach FETCH_HEAD
```

Refresh a checkout only when its `status --porcelain` is empty and its `origin` matches; otherwise report the mismatch and leave it. Record the commit with any finding taken from a clone.

## Effect

| Need                          | Path in `effect`                                     |
| ----------------------------- | ---------------------------------------------------- |
| Exported symbol, JSDoc, types | `packages/effect/src/<Module>.ts`                    |
| Atom and RPC                  | `packages/effect/src/unstable/{reactivity,rpc}`      |
| Test harnesses                | `packages/vitest/src`, `packages/effect/src/testing` |
| Maintained examples           | `packages/effect/test`, package-local tests          |

```sh
rg -n 'symbolName' ~/.deslop/repos/effect/packages/effect/src ~/.deslop/repos/effect/packages/effect/test
```
