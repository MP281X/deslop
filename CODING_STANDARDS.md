# Coding Standards

Repository-specific decisions live here. Reusable coding, testing and visual rules live in the installed engineering, design and testing skills; automated enforcement lives in the tooling.

## Layout

- A service package holds one service in exactly these files: `src/schema.ts` for its schemas, their types, and its domain error; `src/service.ts` for the tag, its shape, and its static layers; `src/lib/utils.ts` for pure helpers; `src/internal/*.ts` for the implementation. Split nothing further, so every package reads the same way.
- Keep `lib/utils.ts` frontend-safe.
- An app owns its RPCs, entrypoints, and services: `rpcs/contracts.ts` holds the RpcGroup and its schemas, `rpcs/handlers.ts` its layer, `lib/utils.ts` the AtomRpc client and shared operations, `services/<name>/` each service in the package shape, `main.server.ts` the HTTP layer graph, and `main.client.tsx` the router and root.

## Apps

- Routes never repeat the base styles (`bg-background text-foreground`) the root applies, and add no `main` or `h1` wrapper they don't need.
- Name by role (`Home`, `utils`), never by kind or app (`AppName`, `web`).

## Runtime

- `packages/runtime` is the single source of truth for what every app shares: server, router, OpenTelemetry, and Vite config.
- Defaults live in code through `Config.withDefault`, never in `.env.example`: `HOST` is `0.0.0.0`, `PORT` is 5000 (the port traefik routes), and one `VITE_OTEL_URL` base serves both traces and logs.

## Generators

- Create apps and packages with the generators AGENTS.md lists, never by copying one.
- A template is real files under `tools/create-*/template/` that the generator copies and edits like any other file, never file bodies inlined as strings, and never generated files such as `*.gen.ts`.
- The app template mirrors the portfolio (its `icon.png`, `__root.tsx`, and entrypoints, with one RPC returning the app name shown on the home page) and always carries the `Dockerfile`, even when an app doesn't deploy.

## Deploy

- Deploy is one `tools/compose.yaml` with configs inlined, direct ports, and unpinned images, driven by commands for this machine; no README, flag-heavy scripts, or nested folders.

## Keys

- Name a service or RPC client key `@deslop/<package>/<path>`, derivable from the file that declares it.

## Imports and Exports

- Map each subpath explicitly in `package.json` `imports`, such as `#lib/*`, `#rpcs/*`, `#schema`, `#service`; never a `#*` glob.
- Export only `./schema`, `./service`, and `./utils` from a service package: no barrel, wildcard, or internal path.

## Dependencies

- Internal apps and services use dependencies declared once in the root `package.json`; published tools declare the dependencies their consumers need.

## RPC

- Declare contracts as an `RpcGroup`, with `stream: true` for subscriptions, and implement them with `RpcContracts.toLayer` returning `RpcContracts.of`.
- The client is an `AtomRpc.Service` over `ClientRuntime.layer`.
- A stream syncs one keep-alive Atom that components read; a component never owns a subscription and never polls.

## Components

- Deslop surfaces use square borders, with no cards or rounded corners.
- Give each context one icon entrypoint for an action instead of text buttons repeating it.
- Leave conventional icons without a tooltip; add a label only where it disambiguates.

## Tooling

- Enable a maintained rule before writing a custom one in `tools/coding-standards/src/rules`.
- A check that needs a script becomes a custom lint rule instead.
- `tools/coding-standards` stays flat under `src/`, with no install tests or separate plugin files; its reusable skills live beside `src/`. Personal native configuration lives in `.codex` and `.claude`, with global skills in `.claude/skills` and `.codex/skills` linked to it; `.agents/skills` contains repository skills only.
