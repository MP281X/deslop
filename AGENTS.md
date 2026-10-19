# Deslop

Decisions the code, the generators and lint do not show.

## Product scope

- No issue tracker: the request is the whole task.
- No portability, multi-user or compatibility code: one user on these two workers. Apps and MCP endpoints are public, with shared authentication through `auth.mp281x.xyz`; `GITHUB_USERS` is an allowlist, not an invitation to add multi-user data.
- Releases are linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Patterns

| Pattern          | Owner and canonical example                                                                    | Consumers                                                                                      | Enforced by                    |
| ---------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| Service          | `tools/create-package/template/`, `apps/stash/src/services/notes/`                             | `rg --files -g '**/service.ts' apps packages tools`                                            | Layout below, review           |
| Web app          | `tools/create-app/template/web/`, which mirrors `apps/portfolio`                               | `rg --files -g '**/index.html' apps tools/create-app/template`                                 | Generator                      |
| Mobile app       | `tools/create-app/template/mobile/`, which mirrors `apps/stash`                                | `rg --files -g '**/app.config.ts' apps tools/create-app/template`                              | Generator                      |
| RPC              | `apps/portfolio/src/rpcs/` and its client in `apps/portfolio/src/lib/utils.ts`                 | `rg --files -g '**/rpcs/contracts.ts' apps tools`                                              | RPC rules below                |
| MCP tools        | `apps/scope/src/tools/`, served by `ServerRuntime.layerMcp` in `apps/scope/src/main.server.ts` | `rg --files -g '**/tools/contracts.ts' apps tools/create-app/template`                         | Generator, review              |
| Web UI primitive | `packages/components-web/src/ui/`, added with `vpx shadcn@latest add` there                    | `rg -l -e @deslop/components-web -e '#components/ui/' apps packages tools/create-app/template` | `shadcn/no-raw-colors`, review |

## Taste

| Area                  | Choice                                                                                    | Rejected                                              | The user's words                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| AI calls              | The Effect AI provider module, directly in the service using it                           | A wrapper `ai` package with its own interface         | "This interface looks like shit … just remove the package and use the effect ai module directly"                |
| Identifiers           | A literal union for a closed set of ids, such as model ids                                | `string`                                              | "The id need to be a literal"                                                                                   |
| Stash note page       | The note's content and tags                                                               | Source and Text in image sections                     | "Sections like the source and text in image can be removed"                                                     |
| Versions              | `latest`; `^X.Y`, or the exact version, only where a peer, the Expo SDK or Vite+ fixes it | `^X.Y.Z` and pins without a reason                    | "when possible use latest or "^\*.\*" … (i perfer latest)"                                                      |
| Development telemetry | A new Effect app with its own OTLP/HTTP JSON receiver and SQLite                          | A Collector dependency or every OTLP transport        | "we already know the apps where this will be used"; "Like for motel I want to write the ingestor/receiver too"  |
| Personal tools        | An always-on server whose MCP tools agents call; T3 pages show the results                | A web UI or a CLI per tool                            | "you can fully replace the scope app with a custom mcp"; "the clis remain as permanent processes (auto update)" |
| Auth                  | Browser sign-in and standard OAuth; clients manage credentials automatically              | Manual API keys and tokens                            | "remove manual tokens, standardize the auth and make the apps public"                                           |
| Auth implementation   | In-repo OAuth for Deslop apps, Codex and Claude Code only                                 | Better Auth and unused provider features              | "keep the auth as simple as possible and remove better auth"                                                    |
| Stash and Auth UI     | Reading-first list, quiet source markers and flat authorization receipt                   | Leading placeholder thumbnails and dense consent text | "i really like B, there is just some misalignment"                                                              |
| Reply pages           | Static HTML from a few shared classes in the agent prompt, values written in place        | Script components that render data lines              | "just to define static html elements that the agent can fill with data and compose"; "js is worse"              |
| Agent instructions    | Only what a model cannot infer: the user's choices, exact values, non-obvious rules       | Full templates and code for known techniques          | "let the models do their job and figure the "known" part out on their own"                                      |

## Layout

- Every schema of a service lives in its `schema.ts`, including the answer of an outside source, such as `FxPost` in `apps/stash/src/services/*/schema.ts`. `lib/utils.ts` holds pure helpers and stays frontend-safe. A file exists once it has content.
- A component one page uses stays in that page's file.
- Node subpath aliases use wildcard `imports`, such as `"#services/*": "./src/services/*"`; source specifiers include their file extension, such as `#services/notes/service.ts`. A service package exports only `./schema`, `./service` and `./utils`.
- App data and CLI credentials live under `~/.deslop/<appname>/`, never the checkout.
- Defaults live in code through `Config.withDefault`, never in `.env.example`.

## RPC and components

- React clients use an `AtomRpc.Service` over `WebRuntime.layer` or `MobileRuntime.layer`; a command line uses a scoped `RpcClient.make`. A stream syncs one keep-alive Atom that components read; a component never owns a subscription and never polls.
- The web look lives in the shadcn theme, `packages/components-web/src/theme.css`; pages add no cards. iOS screens carry the same look through SwiftUI primitives from `@expo/ui` (navigation, toolbars, search, lists, menus, swipe actions, sheets, SF Symbols) with the mobile theme's tokens and their system sizes and behavior; glass for controls and navigation, never content; never a custom system control.
- Each context has one icon entrypoint for an action instead of text buttons repeating it; conventional icons get no tooltip.

## Generators and deploy

- Create apps with `vp create app -- --name <name>` (`--kind mobile` for iOS) and packages with `vp create package -- --name <name>`, then `vp install`; never copy one.
- Deploy is one `tools/compose.yaml` with configs inlined, direct ports and unpinned images; no flag-heavy scripts or nested folders. Each mobile app is one entry in the `ios` matrix of `deploy.yaml` and the `simulator` matrix of `simulator.yaml`.

## Dependencies and tooling

- Keep dependencies in their owning packages; update coupled packages together and verify their real consumers. Vite+ owns its lint and test toolchain versions; its Vite alias is accepted only for the consumer versions listed in `pnpm-workspace.yaml`.
- `@deslop/coding-standards` owns compiler and lint policy: an upstream rule replaces a custom one, each rejected form has one owner, a custom rule's message names the replacement, and its tests assert only custom rules. The root `vite.config.ts` owns formatting and ignores, `.fallowrc.json` dead-code analysis.

## Documents

- One source of truth per fact: the code first, then this file for decisions the code cannot show, a published package's `README.md` only for its install and usage, and environment's deslop reference for commands and procedures. Never a second `AGENTS.md`, a README for an unpublished folder, source-code narration or a rule repeated from a skill.
