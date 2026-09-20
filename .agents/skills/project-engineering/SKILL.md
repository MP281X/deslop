---
name: project-engineering
description: "Use with engineering for this repository's layout, services, RPC, tests, workspace, and visual conventions."
---

Apply the engineering skill first; these are Deslop's own paths, keys, commands and visual decisions.

## Layout

```
// bad — one file holds tag, shape, schemas and implementation
src/Ledger.ts
src/Entry.ts
packages/ai/src/index.ts

// good — one service, these files, nothing else
packages/ai/src
├── schema.ts          // schemas, their types, the domain error
├── service.ts         // the tag, its shape, static layers
├── lib/utils.ts       // pure helpers, frontend-safe
└── internal/pi.ts     // the implementation; service.test.ts tests it through the tag
```

```
// bad — an app service outside its own directory
apps/portfolio/src/notes-service.ts

// good — the app owns rpcs, entrypoints and its services
apps/portfolio/src
├── rpcs/contracts.ts        // the RpcGroup and its schemas
├── rpcs/handlers.ts         // RpcContracts.toLayer
├── lib/utils.ts             // the AtomRpc client, shared operations
├── services/<name>/         // schema.ts, service.ts, internal/*
├── main.server.ts           // the http layer graph
└── main.client.tsx          // makeRouter, Register, createRoot
```

## Keys

```ts
// bad — "the key must be derivable from the path"
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('ledger/Ledger') {}
export class RpcClient extends AtomRpc.Service<RpcClient>()('PortfolioRpc', {

// good — @deslop/<package>/<path>
export class Ai extends Context.Service<Ai, Ai.Agent>()('@deslop/ai/service/Ai') {
export class TemplatePackage extends Context.Service<TemplatePackage, {}>()('@deslop/template-package/service/TemplatePackage') {}
export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/RpcClient', {
```

## Imports

```ts
// bad — parent-relative, or reaching into another package's source
import {portfolioPalette} from '../lib/portfolio.ts'
import {Ai} from '@deslop/ai/src/service.ts'

// good — the subpath imports map, exports for other packages
import {portfolioPalette} from '#lib/portfolio.ts'
import {PortfolioState, RpcContracts} from '#rpcs/contracts.ts'
import {PiToolkit} from '#schema'
import * as ClientRuntime from '@deslop/runtime/client'
```

```json
// bad — a glob import map, or a missing subpath
{"imports": {"#*": "./src/*"}}

// good — apps/portfolio/package.json, packages/ai/package.json
{"imports": {"#lib/*": "./src/lib/*", "#rpcs/*": "./src/rpcs/*", "#routes/*": "./src/routes/*"}}
{"imports": {"#schema": "./src/schema.ts", "#service": "./src/service.ts"}}
```

## Rpc

```ts
// bad — a plain handler shape and a duplicate span
export const RpcHandlers = Layer.succeed(RpcContracts, {'portfolio.join': join})
Effect.withSpan('portfolio.join')(join(payload))

// good — a stream contract, toLayer, of
export class RpcContracts extends RpcGroup.make(
	Rpc.make('portfolio.join', {payload: Schema.Struct(...), stream: true, success: PortfolioState}),
	Rpc.make('portfolio.move', {payload: Schema.Struct(...)})
) {}
export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const state = yield* SubscriptionRef.make(PortfolioState.make({}))
		return RpcContracts.of({'portfolio.join': payload => Stream.unwrap(...), 'portfolio.move': ...})
	})
)
export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/RpcClient', {
	group: RpcContracts,
	protocol: ClientRuntime.layer('@deslop/portfolio')
}) {}
```

```tsx
// bad — a component-owned subscription, or polling
useEffect(() => client('portfolio.join', identity).pipe(Stream.runForEach(setState)), [])
const portfolio = useQuery({queryKey: ['portfolio'], refetchInterval: 1000})

// good — the stream syncs one Atom; components read it
const portfolioAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('portfolio.join', {color: identity.color, id: identity.id, name: identity.name})),
			Stream.unwrap
		)
	)
)
const portfolio = useAtomSuspense(portfolioAtom)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
```

## Tests

```
// bad — a test away from its subject, or on an internal module
packages/ai/tests/pi.test.ts
packages/ai/src/internal/pi.test.ts   // exists today; debt, not the form

// good — beside the public interface it tests
packages/ai/src/service.test.ts
packages/ai/src/lib/utils.test.ts
apps/portfolio/src/services/<name>/service.test.ts
```

```ts
// bad — a layer per test, and library behavior asserted
it.effect('loads', () => pipe(program, Effect.provide(Ai.layerPi(config))))
it('trims the name', () => expect(Schema.decodeUnknownSync(Name)(' pi ')).toBe('pi'))

// good — one it.layer owns the layer; agent-browser proves rendering
it.layer(Layer.provideMerge(Ai.layerPi(config), NodeServices.layer))(test => {
it.effect('replays compact history and streams later events to existing subscribers', Effect.fnUntraced(function* () {
```

## Exports

```json
// bad — a barrel, a wildcard, an internal path
{"exports": {".": "./src/index.ts", "./pi": "./src/internal/pi.ts"}}

// good — packages/ai/package.json
{"exports": {"./utils": "./src/lib/utils.ts", "./schema": "./src/schema.ts", "./service": "./src/service.ts"}}
```

## Dependencies

```json
// bad — packages/ai/package.json redeclaring a dependency the root already owns
{"dependencies": {"@earendil-works/pi-agent-core": "latest", "effect": "^4.0.0-rc"}}

// good — the root package.json declares it once, packages/ai/package.json omits it and imports it
{"dependencies": {"@effect/atom-react": "^4.0.0-rc", "@effect/platform-node": "^4.0.0-rc", "effect": "^4.0.0-rc"}}
{"dependencies": {"@earendil-works/pi-agent-core": "latest", "@earendil-works/pi-ai": "latest"}}
```

## Generators

```sh
# bad — a hand-copied app, or a scoped name
cp -r apps/portfolio apps/notes
vp create package -- --name @deslop/ledger

# good — unscoped kebab-case; install before anything else
vp create app -- --name notes
vp install
vp create package -- --name ledger
vp install
vp run shadcn add dialog
vp run upgrade
```

## Components

```tsx
// bad — a card, rounded corners, a hard-coded color
<Card className="rounded-lg bg-[#1e1e1e] p-6 font-sans">
	<CardHeader>Routes</CardHeader>
</Card>

// good — flat, compact, bordered, monospace, semantic tokens
--font-sans: 'JetBrainsMono Nerd Font Mono', 'JetBrains Mono Variable', monospace;
--radius: 0;
<div className="border-border bg-background flex items-center gap-1 border px-1.5 py-1.5">
<div className="text-muted-foreground grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 pt-2 font-normal">
```

```tsx
// bad — text buttons repeating one context's action
<Button variant="outline">Copy error</Button>
<Button variant="outline">Retry</Button>

// good — one icon entrypoint per context
<Button variant="ghost" size="icon-xs" onClick={() => select(index)} className="h-7 w-auto min-w-7 px-2">
<Alert variant="destructive" className="w-full max-w-lg"><OctagonAlert /></Alert>
```

```tsx
// bad — a tooltip on a conventional icon
<Tooltip content="close"><X /></Tooltip>
<span className="text-[#888]">{props.children}</span>

// good — local classes lay out; a label disambiguates
<div className={className} style={{paddingLeft: 12, paddingRight: 8}} title={props.title}>
<span className="flex h-full min-w-0 flex-1 items-center gap-1.5">
```

## Enforcement

```
// bad — a custom rule where a maintained one exists
tools/workflow/src/rules/*.ts             // effecttsgo already ships this rule

// good — one owner per enforcement surface
tools/workflow/tsconfig.json              // types; the root tsconfig.json keeps only jsx, lib, types and exclude
tools/workflow/src/oxlint.ts              // generic oxlint rules and the plugin default export, including the scoped-source import ban; vite.config.ts keeps ignores, overrides, repo plugins, env, the whole fmt config and the @deslop import group
.fallowrc.json                            // dead code
tools/workflow/src/rules/*.ts             // custom Effect and React forms, one file per rule, fixtures in rules.test.ts
```

## Fallow

```jsonc
// bad — an export nobody imports, a suppression
export const EntryKind = Schema.Literals(['income', 'expense'])
// fallow-ignore-file unused-export -- Generated public service retained for its first consumer.

// good — every export has an importer, except these two
{"ignoreExports": [
	{"exports": ["*"], "file": "packages/*/src/schema.ts"},
	{"exports": ["*"], "file": "packages/components/src/components/**"}
]}
```
