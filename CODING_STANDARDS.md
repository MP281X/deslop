# Coding Standards

Repository-specific decisions live here. Reusable coding, testing and visual rules live in the installed engineering, design and testing skills; automated enforcement lives in the tooling.

## Product scope

- Target this environment and the user's personal-software workflow only.
- Releases are linear and squash-merged. Apply data changes at every merged pull request.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Layout

- A service package holds one service in exactly these files: `src/schema.ts` for its schemas, their types, and its domain error; `src/service.ts` for the tag, its shape, and its static layers; `src/lib/utils.ts` for pure helpers; `src/internal/*.ts` for the implementation. Split nothing further, so every package reads the same way.
- Keep `lib/utils.ts` frontend-safe.
- An app owns its RPCs, entrypoints, and services: `rpcs/contracts.ts` holds the RpcGroup and its schemas, `rpcs/handlers.ts` its layer, `lib/utils.ts` the AtomRpc client and shared operations, `services/<name>/` each service in the package shape, and `routes/` the pages in the web file-router layout, mobile apps included: `__root.tsx`, `(home)/index.tsx`, `<name>.tsx` and `<name>/$id.tsx`. A component one page uses stays in that page's file.
- Entrypoints are `src/main.<role>.ts(x)`: `main.server.ts` the HTTP layer graph, `main.client.tsx` the router and root, and `main.cli.ts` a command line. A web app adds `main.ts` to run the server, because the Vite dev server imports `main.server.ts`; a mobile app has no dev server, so its `main.server.ts` runs itself.
- A mobile app keeps what Expo reads at its root: `app.config.ts`, `eas.json`, `fingerprint.config.js` when it has native files the fingerprint misses, `modules/<name>` for its local native module and `targets/<name>` for app extensions.

## Apps

- Routes never repeat the base styles (`bg-background text-foreground`) the root applies, and add no `main` or `h1` wrapper they don't need.
- Name by role (`Home`, `utils`), never by kind or app (`AppName`, `web`).

## Runtime

- `packages/runtime` is the single source of truth for what every app shares: `./server` (Node server and OpenTelemetry) and `./vite` at `src/`, `./web` (router and RPC client) in `src/web/`, and `./mobile` (RPC client, OpenTelemetry, foreground and updates) and `./mobile/expo` (the Expo config of each app variant) in `src/mobile/`.
- `@deslop/components-web` holds web components at `src/`, shadcn primitives at `src/ui/` and svgl logos at `src/svgs/`. `@deslop/components-mobile` holds the SwiftUI counterparts: `theme.ts`, components at `src/`, helpers at `src/lib/utils.ts`, svgl logos at `src/svgs/` as the SVG files svgl serves, its native views in `ios/`, and an Expo plugin that registers its fonts. It owns its native dependencies; an app lists only the packages it imports.
- Defaults live in code through `Config.withDefault`, never in `.env.example`: `HOST` is `0.0.0.0`, `PORT` is 5000 (the port traefik routes), and one `VITE_OTEL_URL` base serves both traces and logs.

## Generators

- Create apps under `apps/` with `vp create app -- --name <name>`, adding `--kind mobile` for an iOS app, and packages under `packages/` with `vp create package -- --name <name>`, using an unscoped kebab-case name, then `vp install` before anything else; never copy one. Add shadcn components with `vp run shadcn add <component>`; `vp run upgrade` refreshes dependencies.
- A template is real files under `tools/create-*/template/` that the generator copies and edits like any other file, never file bodies inlined as strings, and never generated files such as `*.gen.ts`.
- The web template mirrors the portfolio (its `icon.png`, `__root.tsx`, and entrypoints, with one RPC returning the app name shown on the home page) and always carries the `Dockerfile`, even when an app doesn't deploy. The mobile template mirrors stash's skeleton with the same RPC. A new mobile app needs its EAS project id from `npx eas-cli init` in `app.config.ts`, and after its first store build, `submit.production.ios.ascAppId` in `eas.json`.

## Deploy

- Deploy is one `tools/compose.yaml` with configs inlined, direct ports, and unpinned images, driven by commands for this machine; no deploy README, flag-heavy scripts, or nested folders.
- Each mobile app is one entry in two matrices: `ios` in `.github/workflows/deploy.yaml`, which releases from main, and `simulator` in `.github/workflows/ci.yaml`, which builds branches. [Stash's README](apps/stash/README.md#releases) explains both.
- Reusable tooling ships as a TypeScript package `@deslop/<name>` under `tools/`, published by CI; an app whose CLI shares its code, such as stash, publishes from `apps/`. Add and publish one with [tools/AGENTS.md](tools/AGENTS.md).

## Keys

- Name a service or RPC client key `@deslop/<package>/<path>`, derivable from the file that declares it.

## Imports and Exports

- Map each subpath explicitly in `package.json` `imports`, such as `#lib/*`, `#rpcs/*`, `#schema`, `#service`; never a `#*` glob.
- Export only `./schema`, `./service`, and `./utils` from a service package: no barrel, wildcard, or internal path.

## Dependencies

- Keep dependencies in their existing owning packages; shared root dependencies stay at the root. Resolve version drift with normal package-manager updates, not by relocating declarations.
- Updates stay within declared ranges and supported upstream families; update coupled packages together, then verify their real consumers. Vite+ owns its exact lint and test toolchain versions; do not independently chase their newer tags.
- Peer checks stay strict. Vite+'s versioned Vite alias is accepted only for explicitly inspected consumer versions in `pnpm-workspace.yaml`, not through blanket `allowAny` or TypeScript peer suppression. Recheck compatibility when either side changes.

## RPC

- Declare contracts as an `RpcGroup`, with `stream: true` for subscriptions, and implement them with `RpcContracts.toLayer` returning `RpcContracts.of`.
- The client is an `AtomRpc.Service` over `WebRuntime.layer` or `MobileRuntime.layer`.
- A stream syncs one keep-alive Atom that components read; a component never owns a subscription and never polls.

## Components

- Deslop web surfaces use square borders, with no cards or rounded corners. iOS screens keep the system shapes.
- Give each context one icon entrypoint for an action instead of text buttons repeating it.
- Leave conventional icons without a tooltip; add a label only where it disambiguates.

## Tooling

- A check that needs a script becomes a custom lint rule instead.
- `tsconfig.json` owns jsx, lib, types and exclude only; `vite.config.ts` owns ignores, overrides, repository plugins, env and the entire formatter configuration with the `@deslop` import group; `.fallowrc.json` owns dead-code analysis.

## Local context

- Keep a real `README.md` for public package usage; link `AGENTS.md` to it only when it has agent-specific context. A private folder needs an `AGENTS.md` only for constraints or decisions that its code and configuration cannot explain. Do not create a document or alias just because a package changes.
- No policy duplicated between the repository and a skill, source-code narration, empty templates, `AGENTS.md` files inside `src`, or generic folder documents without a semantic owner. Shared procedures remain in skills; package-specific context belongs in its `AGENTS.md`.
