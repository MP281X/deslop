# Coding standards

Judgement calls no lint rule can check; review cites them by section. A mechanical form belongs to `@deslop/coding-standards` as a lint rule instead.

## Taste

The user's choices; add a row when they pick, reject or correct one not covered here.

| Area                  | Choice                                                                                                                                                                                                               | Rejected                                                                                                     |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| AI calls              | The Effect AI provider module, directly in the service using it                                                                                                                                                      | A wrapper `ai` package with its own interface                                                                |
| Identifiers           | A literal union for a closed set of ids, such as model ids                                                                                                                                                           | `string`                                                                                                     |
| Function arguments    | Short, independent arguments stay positional                                                                                                                                                                         | Wrapping every parameter list in a single object                                                             |
| Development telemetry | A new Effect app with its own public OTLP/HTTP JSON receiver                                                                                                                                                         | A Collector dependency, every OTLP transport, an authenticated second port                                   |
| App storage           | Effect KeyValueStore                                                                                                                                                                                                 | SQLite and migration machinery                                                                               |
| Personal tools        | An npm app CLI with foreground and `service` subcommands, every dependency bundled and native tools in its `bin/`; persistent HTTP MCP and a small web UI; `CliRuntime.runApp` reading the package beside its bundle | A stdio MCP bridge or process/data writer per tool; containers; a download or unpack command per tool        |
| Auth                  | Browser sign-in and standard OAuth; clients manage credentials automatically                                                                                                                                         | Manual API keys and tokens                                                                                   |
| Auth implementation   | Optional Deslop issuer integration; localhost works without an auth server; standards-based OAuth clients; one origin check in the runtime; Deploy workers share one key                                             | Mandatory shared Auth for a local install; protected-resource enrollment; CLI sign-in; per-app origin checks |
| Auth approvals        | One code reads one sign-in, approved in the user's own browser                                                                                                                                                       | An inbox of every waiting sign-in; the agent browser                                                         |
| Agent approvals       | The agent answers an app or agent sign-in by its code through the auth MCP, as the browser does; a browser sign-in is approved only from a signed-in browser                                                         | Approving only Simulator sign-ins; an agent token minting browser sessions                                   |
| Preview auth          | Without `--auth` everything is the trusted developer, Auth's GitHub step included, behind a loopback, IP and `--url` host allowlist; explicit `--auth` is always enforced                                            | A required issuer for a local preview; an explicit auth flag silently bypassed in development                |
| Readonly              | Plain `T[]` and properties; `readonly` only where a type needs it, such as a parameter taking a schema's array                                                                                                       | A lint rule against `readonly`, mutable schemas and conversions to satisfy it                                |

## Layout

- **Schemas** of a service all live in its `schema.ts`, an outside source's answer included, such as `FxPost` in `apps/stash/src/services/*/schema.ts`. `lib/utils.ts`: pure helpers.
- **Ownership.** Page-private components and helpers stay with their consumer; shared behavior has one owner. A new abstraction adds a capability the owner lacks or lightens what a reader holds, never just shorter files.
- **Directness.** Domain names and plain control flow over wrappers and configuration languages; colocation balanced against navigable file size.
- **Processes** with named states and events (a sign-in, an import, a playback) are `@typeonce/effect-machine` machines, not coordinated flags, timers and effects: states own their data and running work; `Machine.start` in the owning service, `AtomMachine` on a client, `MachineState` from `@typeonce/effect-machine-react` to render.
- **Indexes** for repeated relationships, built once: a set for membership, a map for lookup, `Array.groupBy` for one-to-many, as in Scope's telemetry views. Preserve key uniqueness, first-match semantics and reference-sensitive change detection; bounded lists and pairwise algorithms need none.
- **Imports.** Wildcard `imports` aliases, such as `"#services/*": "./src/services/*"`; specifiers with their extension, such as `#services/notes/service.ts`. A service package exports only `./schema`, `./service`, `./utils`.
- **App data** through `ServerRuntime.dataDirectory`: `~/.deslop/<appname>/` installed, `.deslop/<appname>/` in a checkout; settings as flags, secrets in `~/.deslop/<appname>.env`.
- **Defaults** in code through `Config.withDefault`, never in `.env.example`.

## RPC and components

- **Clients.** React: an `AtomRpc.Service` over `WebRuntime.layer` (Scope's page: `WebRuntime.layerProtocol`, so it never traces itself) or `MobileRuntime.layerSignedIn` once an app signs in (`layer` in the generated template, which has none); a command line: a scoped `RpcClient.make`. A stream syncs one keep-alive Atom that components read; components neither subscribe nor poll.
- **Look** from `DESIGN.md`: on the web its tokens in `packages/components-web/src/theme.css` and the shadcn components; on iOS the shadcn-named components in `packages/components-mobile/src/ui/` over `@expo/ui`, with `packages/components-mobile/src/theme.ts`.
- **Actions**: one icon entrypoint per context, no repeating text buttons. Keep accessible names; hover and focus reveal names where icons replace visible labels.

## Tests and measurements

- **Keep** tests of owned runtime behavior that fail when it breaks and survive an equivalent implementation; not private structure, mocks, library or type-system guarantees. No new test beats one that has to change with every refactor.
- **One behavior per scenario.** Merge genuine subsets, keeping unique assertions, or drop the repeat from the broader test. Similar setup isn't duplication: different inputs, dependencies, timing, state or failure paths protect different behavior.
- **E2E** proves the user's input through its outcome, relevant failures included, not merely that screens open.
- **One-off assumptions**: inline probes or browser proofs; a fix alone doesn't earn a persistent test.
- **Performance claims**: same workload and environment, repeated runs, representative timings and the resource costs the change affects.

## Deploy

Each app is an npm package run as a user service on its worker, at its own default port; Deploy's Caddy serves the public hostnames. Releases publish an app only when what it ships changed, and services follow npm's latest release without rollback.

## Dependencies and tooling

- **Versions.** Dependencies in their owning packages on `latest`; `^X.Y` or exact only where a peer, the Expo SDK or Vite+ fixes it. Coupled packages update together, verified in their real consumers. Vite+ owns its lint and test toolchain versions.
- **Tools** through their own flags, caches and defaults; configure only where this repository deviates; no wrapper scripts, re-declared defaults or workaround caps.
- **Libraries** only through published releases and public API. No patches, forks, dependency overrides or shims; shadcn registry components refreshed by its CLI are the sole vendored exception. When a library falls short, change this design, pick another library or ask the user.
- **Metadata exception**: a release's wrong package metadata (an undeclared dependency, a stale pin) may be corrected in `pnpm-workspace.yaml` with `packageExtensions` or an override, beside a comment naming the upstream defect, removed once a release fixes it.
- **Lint policy** in `@deslop/coding-standards`:
  - **Once**: each policy defined once; tests only for custom rules; native rules picked by name with every category off, so a tool upgrade opts into nothing; a declined rule is left out.
  - **No overlap**: each check in the one tool covering it best, proven with the custom rule's failing cases; the compiler and the Effect Oxlint rules own theirs; no rule for a form the preset already bans.
  - **One gate**: `check`, and `fix` in Verify, run Oxfmt, the typed Oxlint pass on tsrs with the Effect rules and TypeScript diagnostics, a syntax-only pass over the templates, then Fallow; no package keeps a typecheck script.
  - **Reach**: only checks that can fire here, preventive ones included for patterns t3code and Dual already hit; `exactOptionalPropertyTypes` off.
  - **Custom rules** earn their place with coverage or a safe fix no native rule offers.
  - **Combined gate**: intended forms stay accepted, fixes converge.
