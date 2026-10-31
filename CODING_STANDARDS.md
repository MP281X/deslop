# Coding standards

Judgement calls no lint rule can check; review cites them by section. A mechanical form belongs to `@deslop/coding-standards` as a lint rule instead.

## Taste

The user's choices; add a row when they pick, reject or correct one not covered here.

| Area                  | Choice                                                                                                                                                       | Rejected                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------ |
| AI calls              | The Effect AI provider module, directly in the service using it                                                                                              | A wrapper `ai` package with its own interface                                                    |
| Identifiers           | A literal union for a closed set of ids, such as model ids                                                                                                   | `string`                                                                                         |
| Function arguments    | Short, independent arguments stay positional                                                                                                                 | Wrapping every parameter list in a single object                                                 |
| Development telemetry | A new Effect app with its own OTLP/HTTP JSON receiver                                                                                                        | A Collector dependency or every OTLP transport                                                   |
| App storage           | Effect KeyValueStore                                                                                                                                         | SQLite and migration machinery                                                                   |
| Personal tools        | An always-on server whose MCP tools agents call; T3 pages show the results                                                                                   | A web UI or a CLI per tool                                                                       |
| Auth                  | Browser sign-in and standard OAuth; clients manage credentials automatically                                                                                 | Manual API keys and tokens                                                                       |
| Auth implementation   | In-repo OAuth for Deslop apps, Codex and Claude Code only                                                                                                    | Better Auth and unused provider features                                                         |
| Auth approvals        | One code reads one sign-in, approved in the user's own browser                                                                                               | An inbox of every waiting sign-in; the agent browser                                             |
| Agent approvals       | The agent answers an app or agent sign-in by its code through the auth MCP, as the browser does; a browser sign-in is approved only from a signed-in browser | A dev-only mock auth; approving only Simulator sign-ins; an agent token minting browser sessions |
| Lists                 | Spacing between rows; opm chapters show a cover, two lines and a small reading disc                                                                          | Divider lines in any list or mock; opm's "x/y" pages                                             |
| Readonly              | Plain `T[]` and properties; `readonly` only where a type needs it, such as a parameter taking a schema's array                                               | A lint rule against `readonly`, mutable schemas and conversions to satisfy it                    |

## Layout

- Every schema of a service lives in its `schema.ts`, including the answer of an outside source, such as `FxPost` in `apps/stash/src/services/*/schema.ts`. `lib/utils.ts` holds pure helpers.
- Page-private components and helpers stay with their consumer; shared behavior has one owner. A new abstraction must supply a capability the existing owner lacks or reduce what a reader holds, not merely shorten files. Prefer direct domain names and control flow over wrappers and configuration languages; balance colocation against navigable file size.
- A process with named states and the events that move between them, such as a sign-in, an import or a playback, is a machine from `@typeonce/effect-machine` rather than flags, timers and effects that coordinate it: states own their data and their running work, `Machine.start` in the service that owns it, `AtomMachine` for a client process, and `MachineState` from `@typeonce/effect-machine-react` to render a state.
- Index repeated relationships once: a set for membership, a map for lookup, or `Array.groupBy` for one-to-many joins, as in Scope's telemetry views. Preserve key uniqueness, first-match semantics and reference-sensitive change detection; bounded lists and genuinely pairwise algorithms need no index merely to satisfy a metric.
- Node subpath aliases use wildcard `imports`, such as `"#services/*": "./src/services/*"`; source specifiers include their file extension, such as `#services/notes/service.ts`. A service package exports only `./schema`, `./service` and `./utils`.
- App data and CLI credentials live under `~/.deslop/<appname>/`, outside the checkout.
- Defaults live in code through `Config.withDefault`, never in `.env.example`.

## RPC and components

- React clients use an `AtomRpc.Service` over `WebRuntime.layer` or `MobileRuntime.layer`; a command line uses a scoped `RpcClient.make`. A stream syncs one keep-alive Atom that components read; components neither own subscriptions nor poll.
- The web look lives in the shadcn theme, `packages/components-web/src/theme.css`; pages add no cards. iOS screens carry the same look through SwiftUI primitives from `@expo/ui` (navigation, toolbars, search, lists, menus, swipe actions, sheets, SF Symbols) with the mobile theme's tokens and their system sizes and behavior; glass for controls and navigation, never content; system controls stay native.
- Each context has one icon entrypoint for an action instead of text buttons repeating it; conventional icons get no tooltip.

## Tests and measurements

Keep tests of owned runtime behavior that survive equivalent implementations, not private structure or library and type-system guarantees. Each scenario protects a distinct behavior: merge genuine subsets, preserving unique assertions, or remove repeated protection from the broader test. Similar setup is not duplication; different inputs, dependencies, timing, state or failure paths can protect different behavior. E2E proves the user's input through the outcome, including relevant failures, not merely that screens open. Use inline probes or browser proofs for one-off assumptions; a fix alone does not justify another persistent test.

A performance claim compares the same workload and environment over repeated runs, with representative timings and the resource costs the change affects.

## Deploy

Deploy is one `tools/compose.yaml` with configs inlined, direct ports, third-party images on `latest` and app images tagged by the deploying commit.

## Dependencies and tooling

- Keep dependencies in their owning packages on `latest`; `^X.Y` or an exact version only where a peer, the Expo SDK or Vite+ fixes it. Update coupled packages together and verify their real consumers. Vite+ owns its lint and test toolchain versions.
- Use each tool through its own flags, caches and defaults; configure only where this repository deviates, never with wrapper scripts, re-declared defaults or workaround caps.
- Use every third-party library only through its published releases and public API, the way its documentation intends. Never change a library's code or behavior from outside: no patches, forks, vendored copies, dependency overrides or shims, and none to get an upgrade through either. When a library lacks something or an upgrade breaks, change this repository's design to fit the library, choose a different library, or ask the user. The one exception is package metadata a published release gets wrong, such as an undeclared dependency or a stale version pin: `pnpm-workspace.yaml` may correct it with `packageExtensions` or an override, beside a comment naming the upstream defect, and drops the correction once a release fixes it.
- `@deslop/coding-standards` owns compiler and lint policy: define each policy once, prefer an upstream rule to a custom one, and test only custom rules. Native rules are enabled by name with every category off; custom rules come from their registry. Each check runs in the one tool that covers it most completely, with no overlap: the compiler and Effect diagnostics own what they report, and a rule for a form the preset already bans elsewhere is not selected. Keep only checks that can fire on this code, preventive ones included for patterns comparable codebases such as t3code and Dual already hit; type-aware lint and `exactOptionalPropertyTypes` stay off. A custom rule earns its place with coverage or a safe fix no native rule offers. Judge the combined gate: intended forms stay accepted and fixes converge.
