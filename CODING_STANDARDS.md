# Coding standards

Judgement calls no lint rule can check; review cites them by section. A mechanical form belongs to `@deslop/coding-standards` as a lint rule instead.

## Taste

The user's choices. Add a row with their words when they pick, reject or correct an uncovered choice.

| Area                  | Choice                                                                                    | Rejected                                                 | The user's words                                                                                                 |
| --------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| AI calls              | The Effect AI provider module, directly in the service using it                           | A wrapper `ai` package with its own interface            | "This interface looks like shit … just remove the package and use the effect ai module directly"                 |
| Identifiers           | A literal union for a closed set of ids, such as model ids                                | `string`                                                 | "The id need to be a literal"                                                                                    |
| Stash note page       | The note's content and tags                                                               | Source and Text in image sections                        | "Sections like the source and text in image can be removed"                                                      |
| Versions              | `latest`; `^X.Y`, or the exact version, only where a peer, the Expo SDK or Vite+ fixes it | `^X.Y.Z` and pins without a reason                       | "when possible use latest or "^\*.\*" … (i perfer latest)"                                                       |
| Development telemetry | A new Effect app with its own OTLP/HTTP JSON receiver and SQLite                          | A Collector dependency or every OTLP transport           | "we already know the apps where this will be used"; "Like for motel I want to write the ingestor/receiver too"   |
| Personal tools        | An always-on server whose MCP tools agents call; T3 pages show the results                | A web UI or a CLI per tool                               | "you can fully replace the scope app with a custom mcp"; "the clis remain as permanent processes (auto update)"  |
| Auth                  | Browser sign-in and standard OAuth; clients manage credentials automatically              | Manual API keys and tokens                               | "remove manual tokens, standardize the auth and make the apps public"                                            |
| Auth implementation   | In-repo OAuth for Deslop apps, Codex and Claude Code only                                 | Better Auth and unused provider features                 | "keep the auth as simple as possible and remove better auth"                                                     |
| Stash and Auth UI     | Reading-first list, quiet source markers and flat authorization receipt                   | Leading placeholder thumbnails and dense consent text    | "i really like B, there is just some misalignment"                                                               |
| opm chapter list      | Cover, always two lines, a small reading disc; no dividers                                | Row dividers, "x/y" page counts, a Continue section      | "just remove the divider lines, they are useless and kinda ugly to be honest"                                    |
| Auth approvals        | Live pending requests grouped by app; approval in the user's own browser                  | Chronological inbox; signing in inside the agent browser | "B looks a lot better, go for it"; "i can't login in your browser"                                               |
| Agent approvals       | The agent lists and answers any waiting sign-in through the auth MCP, as the browser does | A dev-only mock auth; approving only Simulator sign-ins  | "the agent should be able to approve any request in the same way as be manually approving them from the website" |

## Layout

- Every schema of a service lives in its `schema.ts`, including the answer of an outside source, such as `FxPost` in `apps/stash/src/services/*/schema.ts`. `lib/utils.ts` holds pure helpers and stays frontend-safe.
- Page-private components and helpers stay with their consumer; genuinely shared behavior has one common owner. A boundary earns its place by reducing what the reader holds, not merely shortening files; balance colocation against navigable file size.
- Node subpath aliases use wildcard `imports`, such as `"#services/*": "./src/services/*"`; source specifiers include their file extension, such as `#services/notes/service.ts`. A service package exports only `./schema`, `./service` and `./utils`.
- App data and CLI credentials live under `~/.deslop/<appname>/`, outside the checkout.
- Defaults live in code through `Config.withDefault`, never in `.env.example`.

## RPC and components

- React clients use an `AtomRpc.Service` over `WebRuntime.layer` or `MobileRuntime.layer`; a command line uses a scoped `RpcClient.make`. A stream syncs one keep-alive Atom that components read; components neither own subscriptions nor poll.
- The web look lives in the shadcn theme, `packages/components-web/src/theme.css`; pages add no cards. iOS screens carry the same look through SwiftUI primitives from `@expo/ui` (navigation, toolbars, search, lists, menus, swipe actions, sheets, SF Symbols) with the mobile theme's tokens and their system sizes and behavior; glass for controls and navigation, never content; system controls stay native.
- Each context has one icon entrypoint for an action instead of text buttons repeating it; conventional icons get no tooltip.

## Tests

Keep useful tests of owned runtime behavior when their protection earns ongoing maintenance. Use throwaway inline probes or browser proofs for one-off assumptions; a fix does not automatically need a new persistent regression test. Tests should survive equivalent implementations rather than freeze private structure or re-test library and type-system guarantees. Preserve useful tests when simplifying.

## Deploy

Deploy is one `tools/compose.yaml` with configs inlined, direct ports and unpinned images. Each mobile app is one entry in the `ios` matrix of `deploy.yaml` and the `simulator` matrix of `simulator.yaml`.

## Dependencies and tooling

- Keep dependencies in their owning packages; update coupled packages together and verify their real consumers. Vite+ owns its lint and test toolchain versions; its Vite alias is accepted only for the consumer versions listed in `pnpm-workspace.yaml`.
- `@deslop/coding-standards` owns compiler and lint policy: an upstream rule replaces a custom one, each rejected form has one owner, and its tests assert only custom rules. The root `vite.config.ts` owns formatting and ignores, `.fallowrc.json` dead-code analysis.
