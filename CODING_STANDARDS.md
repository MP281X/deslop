# Coding Standards

Repository-specific decisions that the code, the generators and lint do not already show. Reusable engineering, design and review rules live in the installed shared skills.

## Product scope

- Target this environment and the user's personal-software workflow only.
- Releases are linear and squash-merged; a newer merge cancels an older release run, so a data change covers everything since the last successful deploy.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Layout

- A service's public contract lives in `src/schema.ts` (schemas, types, domain error) and `src/service.ts` (tag, shape, static layers); a sole implementation stays inline in its Layer, as in `apps/stash/src/services/notes/service.ts`, and private adapters go in `src/lib/`. Every schema of a service lives in its `schema.ts`, including the answer of an outside source, such as `FxPost` and `Metadata` in `apps/stash/src/services/*/schema.ts`. `lib/utils.ts` holds pure helpers and stays frontend-safe. Each file exists once it has content.
- A component one page uses stays in that page's file.
- Workspace packages export their TypeScript source directly, with no library build; tools and apps require Node 26.

## Patterns

Engineering's Patterns rule reads this table.

| Pattern          | Owner and canonical example                                                    | Consumers                                                                                      | Enforced by                    |
| ---------------- | ------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | ------------------------------ |
| Service          | `tools/create-package/template/`, `apps/stash/src/services/notes/`             | `rg --files -g '**/service.ts' apps packages tools`                                            | Layout above, review           |
| Web app          | `tools/create-app/template/web/`, which mirrors `apps/portfolio`               | `rg --files -g '**/index.html' apps tools/create-app/template`                                 | Generator                      |
| Mobile app       | `tools/create-app/template/mobile/`, which mirrors `apps/stash`                | `rg --files -g '**/app.config.ts' apps tools/create-app/template`                              | Generator                      |
| RPC              | `apps/portfolio/src/rpcs/` and its client in `apps/portfolio/src/lib/utils.ts` | `rg --files -g '**/rpcs/contracts.ts' apps tools`                                              | RPC rules below                |
| Web UI primitive | `packages/components-web/src/ui/`, added with `vp run shadcn add`              | `rg -l -e @deslop/components-web -e '#components/ui/' apps packages tools/create-app/template` | `shadcn/no-raw-colors`, review |

## Taste

Engineering's Taste rule reads and extends this table.

| Area            | Choice                                                          | Rejected                                      | The user's words                                                                                 |
| --------------- | --------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| AI calls        | The Effect AI provider module, directly in the service using it | A wrapper `ai` package with its own interface | "This interface looks like shit … just remove the package and use the effect ai module directly" |
| Identifiers     | A literal union for a closed set of ids, such as model ids      | `string`                                      | "The id need to be a literal"                                                                    |
| Stash note page | The note's content and tags                                     | Source and Text in image sections             | "Sections like the source and text in image can be removed"                                      |

## Apps

- Routes inherit the base styles the root applies (`bg-background text-foreground`) and add a `main` or `h1` wrapper only when the page needs it.
- Name by role (`Home`, `utils`), never by kind or app (`AppName`, `web`).
- Defaults live in code through `Config.withDefault`, never in `.env.example`: `HOST` is `0.0.0.0`, `PORT` is 5000 (the port traefik routes). Web and server telemetry read one `VITE_OTEL_URL` base for traces and logs; the Expo config reads `OTEL_URL`.

## Generators

- Create apps with `vp create app -- --name <name>` (`--kind mobile` for iOS) and packages with `vp create package -- --name <name>`, an unscoped kebab-case name, then `vp install` before anything else; never copy one. `vp run upgrade` refreshes dependencies.
- The web template always carries the `Dockerfile`, even when an app doesn't deploy. A new mobile app needs its EAS project id from `npx eas-cli init` in `app.config.ts`, and after its first store build, `submit.production.ios.ascAppId` in `eas.json`.

## Deploy

- Deploy is one `tools/compose.yaml` with configs inlined, direct ports, and unpinned images, driven by commands for this machine; no deploy README, flag-heavy scripts, or nested folders.
- Each mobile app is one entry in two matrices: `ios` in `.github/workflows/deploy.yaml`, which releases from main, and `simulator` in `.github/workflows/simulator.yaml`, which builds branches that change `apps/stash`, `packages` or the lockfile. [Stash's README](apps/stash/README.md#releases) explains both.
- Published tools follow [tools/AGENTS.md](tools/AGENTS.md); generators stay private; an app whose CLI shares its code, such as stash, publishes from `apps/`.

## Imports and Exports

- Map each subpath explicitly in `package.json` `imports`, such as `#lib/*`, `#rpcs/*`, `#schema`, `#service`; never a `#*` glob.
- Export only `./schema`, `./service`, and `./utils` from a service package: no barrel, wildcard, or other `lib` path.

## Dependencies

- Keep dependencies in their existing owning packages; shared root dependencies stay at the root. Resolve version drift with normal package-manager updates, not by relocating declarations.
- Update coupled packages together, then verify their real consumers. Vite+ owns its exact lint and test toolchain versions; do not independently chase their newer tags.
- Vite+'s versioned Vite alias is accepted only for the consumer versions listed in `pnpm-workspace.yaml`; recheck them when either side changes.

## RPC

- React clients use an `AtomRpc.Service` over `WebRuntime.layer` or `MobileRuntime.layer`; a command line uses a scoped `RpcClient.make`.
- A stream syncs one keep-alive Atom that components read; a component never owns a subscription and never polls.

## Components

- Deslop's web look lives in its shadcn theme, `packages/components-web/src/theme.css`; primitives keep their shipped shapes, and pages add no cards. iOS screens keep the system shapes.
- Give each context one icon entrypoint for an action instead of text buttons repeating it.
- Leave conventional icons without a tooltip; give every icon-only control an accessible label.

## Tooling

- A check that needs a script becomes a custom lint rule instead.
- `@deslop/coding-standards` owns compiler and lint policy; the root `vite.config.ts` owns repository formatting and ignores, `.fallowrc.json` dead-code analysis.

## Local context

- Keep a real `README.md` for public package usage; link `AGENTS.md` to it only when it has agent-specific context. A private folder needs an `AGENTS.md` only for constraints or decisions that its code and configuration cannot explain.
- No policy duplicated between the repository and a skill, source-code narration, empty templates, `AGENTS.md` files inside `src`, or generic folder documents without a semantic owner.
