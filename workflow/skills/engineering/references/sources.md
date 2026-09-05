# Source Catalog

Reference checkouts live under `/tmp/deslop/repos`. Explore owns cloning and refreshing the repository it needs. Other roles consume Explore's findings rather than repeating source research.

## Commands

```bash
mkdir -p /tmp/deslop/repos
git clone --depth 1 --single-branch https://github.com/<owner>/<repo>.git /tmp/deslop/repos/<name>
```

Before refreshing an existing checkout, inspect its root, working tree, and origin:

```bash
git -C /tmp/deslop/repos/<name> rev-parse --show-toplevel
git -C /tmp/deslop/repos/<name> status --porcelain
git -C /tmp/deslop/repos/<name> remote get-url origin
```

Continue only when this is the intended checkout, status is empty, and origin matches the catalog. Preserve a dirty checkout; do not reset it or silently replace its origin.

```bash
git -C /tmp/deslop/repos/<name> fetch --depth 1 origin HEAD
git -C /tmp/deslop/repos/<name> checkout --detach FETCH_HEAD
git -C /tmp/deslop/repos/<name> rev-parse HEAD
```

For the OpenCode branch entry, clone with `--branch v2` and refresh with `git -C /tmp/deslop/repos/opencode fetch --depth 1 origin v2`. Keep the selected revision stable for the investigation and report its commit with the finding. Coordinate overlapping checkout use through Primary before refreshing.

If refresh fails, report the failure and qualify any existing source evidence with its revision. Match the installed or locked dependency revision when establishing project behavior; latest upstream source alone does not prove installed behavior. Fetch more history only when the investigation requires it.

## Repositories

| Name            | Repository                        | Use                                                         |
| --------------- | --------------------------------- | ----------------------------------------------------------- |
| base-ui         | `MUI/base-ui`                     | Base UI implementation                                      |
| codex           | `openai/codex`                    | Codex CLI, agents, skills, configuration, and orchestration |
| effect          | `Effect-TS/effect`                | Effect v4 implementation and exemplar code                  |
| effect-tsgo     | `Effect-TS/tsgo`                  | Effect TypeScript diagnostics and Oxlint integration        |
| executor        | `UsefulSoftwareCo/executor`       | Exemplar Effect application architecture                    |
| fallow          | `fallow-rs/fallow`                | Fallow implementation and configuration                     |
| legend-list     | `LegendApp/legend-list`           | Legend List implementation                                  |
| lexical         | `facebook/lexical`                | Lexical editor and React integration                        |
| opencode        | `anomalyco/opencode`, branch `v2` | OpenCode implementation and exemplar Effect code            |
| oxc             | `oxc-project/oxc`                 | Oxc and Oxlint implementation and rules                     |
| pi              | `earendil-works/pi`               | Pi agent core and AI packages                               |
| pierre-diffs    | `pierrecomputer/pierre`           | Pierre diffs implementation                                 |
| react           | `facebook/react`                  | React 19, React DOM, hooks, and React Compiler              |
| react-doctor    | `millionco/react-doctor`          | React Doctor implementation and rules                       |
| t3code          | `pingdotgg/t3code`                | Exemplar Effect application architecture                    |
| tanstack-form   | `TanStack/form`                   | TanStack Form and React integration                         |
| tanstack-hotkey | `TanStack/hotkeys`                | TanStack Hotkeys and React integration                      |
| tanstack-router | `TanStack/router`                 | TanStack Router, generator, and plugin                      |
| typescript      | `microsoft/TypeScript`            | TypeScript compiler and type system                         |
| vite-plus       | `voidzero-dev/vite-plus`          | Vite+ implementation, commands, and configuration           |

## Effect lookup

| Question                     | Path under `/tmp/deslop/repos/effect`                                         |
| ---------------------------- | ----------------------------------------------------------------------------- |
| Domain operation or Schema   | `packages/effect/src/<Module>.ts`                                             |
| Atom and RPC                 | `packages/effect/src/unstable/reactivity`, `packages/effect/src/unstable/rpc` |
| Test harness                 | `packages/vitest/src`, `packages/effect/src/testing`                          |
| Maintained behavior examples | `packages/effect/test` and package-local tests                                |

```bash
rg -n 'symbolName' /tmp/deslop/repos/effect/packages/effect/src /tmp/deslop/repos/effect/packages/effect/test
```
