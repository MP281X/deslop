# Coding Standards

Automated formatting, lint, and type rules live in the tooling and are not repeated here.

## Layout

- A service package holds one service in exactly these files: `src/schema.ts` for its schemas, their types, and its domain error; `src/service.ts` for the tag, its shape, and its static layers; `src/lib/utils.ts` for pure helpers; `src/internal/*.ts` for the implementation. Split nothing further, so every package reads the same way.
- Keep `lib/utils.ts` frontend-safe.
- An app owns its RPCs, entrypoints, and services: `rpcs/contracts.ts` holds the RpcGroup and its schemas, `rpcs/handlers.ts` its layer, `lib/utils.ts` the AtomRpc client and shared operations, `services/<name>/` each service in the package shape, `main.server.ts` the HTTP layer graph, and `main.client.tsx` the router and root.
- Create apps and packages with the generators AGENTS.md lists, never by copying one.

## Keys

- Name a service or RPC client key `@deslop/<package>/<path>`, derivable from the file that declares it.

## Imports and Exports

- Map each subpath explicitly in `package.json` `imports`, such as `#lib/*`, `#rpcs/*`, `#schema`, `#service`; never a `#*` glob.
- Export only `./schema`, `./service`, and `./utils` from a service package: no barrel, wildcard, or internal path.

## Dependencies

- Declare a dependency once, in the root `package.json`; a package imports it without redeclaring it.

## RPC

- Declare contracts as an `RpcGroup`, with `stream: true` for subscriptions, and implement them with `RpcContracts.toLayer` returning `RpcContracts.of`.
- The client is an `AtomRpc.Service` over `ClientRuntime.layer`.
- A stream syncs one keep-alive Atom that components read; a component never owns a subscription and never polls.

## Tests

- Put a test beside the public interface it tests, such as `src/service.test.ts` or `src/lib/utils.test.ts`, never in a separate `tests/` folder.
- Prove rendering with agent-browser, never with a component test.

## Components

- Keep surfaces flat, compact, and bordered: no cards and no rounded corners.
- Give each context one icon entrypoint for an action instead of text buttons repeating it.
- Leave conventional icons without a tooltip; add a label only where it disambiguates.

## Tooling

- Enable a maintained rule before writing a custom one in `tools/workflow/src/rules`.
