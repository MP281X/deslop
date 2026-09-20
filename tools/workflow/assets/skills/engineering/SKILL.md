---
name: engineering
description: 'Use for product-code architecture, implementation, coding style, testing, or review.'
---

Write code to these rules; apply the repository's `project-engineering` skill where one exists. Static analysis catches regressions; it never fixes code: every rule below is written correctly the first time, whether or not a linter checks it.

## Types

```ts
// bad — "are you sure this doesn't infer everything?"
fn: RpcClient.runtime.fn<{onSuccess: (message: string) => void}>()(
const Input = Schema.Struct({value: Schema.String}) satisfies Schema.Schema<Input>

// good — inferred; only a recursive function is annotated
const rootDependencies = pipe(
	Schema.decodeSync(PackageManifest)(readFileSync(new URL('package.json', root), 'utf8')),
	dependencyNames,
	HashSet.fromIterable
)
function visit(node: Node): Result {
	return visit(node.parent)
}
```

```ts
// bad — "the rest of the assertions should be banned"
const user = JSON.parse(text) as User
const parsed = value as Parsed

// good — satisfies and as const only
return Effect.succeed([{text: part.text, type: 'text'} satisfies TextContent])
export const AiAgent = Schema.Literals(['pi'] as const)
```

```ts
// bad — "data inside the program matches its type"
create: Effect.fnUntraced(function* (input: unknown) {
	const note = yield* Schema.decodeUnknownEffect(CreateNote)(input)
const add = Effect.fn('Ledger.add')(function* (draft: LedgerDraft) {
	const decoded = yield* Schema.decodeEffect(LedgerDraft)(draft) // draft is already LedgerDraft

// good — unknown only where a provider payload enters; a method takes the schema's Type as is
const params = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(part.params)
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage) {
```

## Schema

```ts
// bad — "the type ... same name ... the line before"
export const GitDiffStatus = Schema.Literals(['added', 'deleted', 'modified'])
export interface GitDiffStatusType {}
const Tag = pipe(Schema.String, Schema.check(Schema.isNonEmpty())) // every schema, exported or not
const LedgerFile = Schema.fromJsonString(Schema.Array(LedgerEntry))

// good
export type AiAgent = typeof AiAgent.Type
export const AiAgent = Schema.Literals(['pi'] as const)
export type AiSessionId = typeof AiSessionId.Type
export const AiSessionId = Schema.Struct({agent: AiAgent, id: Schema.String})
```

```ts
// bad — "all the Schema.Class should be replaced with Schema.Struct"
export class PortfolioVisitor extends Schema.Class<PortfolioVisitor>('PortfolioVisitor')({
	color: Schema.NonEmptyString,
	id: Schema.NonEmptyString
}) {}

// good
export type PortfolioVisitor = typeof PortfolioVisitor.Type
export const PortfolioVisitor = Schema.Struct({color: Schema.NonEmptyString, id: Schema.NonEmptyString})
```

```ts
// bad — "useless alias, harder to follow the code flow"
const decode = Schema.decodeUnknownEffect(Input)
const result = decode(input)
const ToolFailure = Schema.Defect()

// good — schema pair at module scope, decode at the call site
type PackageManifest = typeof PackageManifest.Type
const PackageManifest = Schema.fromJsonString(
	Schema.Struct({dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String))})
)

Schema.decodeSync(PackageManifest)(readFileSync(new URL('package.json', root), 'utf8'))
```

```ts
// bad — "the schema .make method directly without wrapping it"
function cursorFromBigInt(value: bigint) {
	return RunEventCursor.make(value.toString())
}
function checked(value: bigint) {
	if (value < 0n) throw new Error('negative')
	return RunEventCursor.make(value.toString())
}

// good — the schema owns validation and defaults
return Effect.fail(ServiceAiError.make({message: `Pi does not support ${part.mediaType} prompt parts`}))
```

## Effect

```ts
// bad — "you shouldn't manually decode json without effect schema"
const raw: unknown = JSON.parse(body)
const payload = Schema.decodeUnknownSync(RequestPayload)(raw)
const count = parseInt(input.count)

// good — Schema, Array, String, Number, Predicate over globals
Schema.decodeSync(Schema.fromJsonString(PackageManifest))(text)
Option.map(Number.parse(event.target.value), field.handleChange)
const isApiUrl = Predicate.compose(
	String.isString,
	Predicate.or(Equal.equals('/api'), Predicate.or(String.startsWith('/api/'), String.startsWith('/api?')))
)
```

```ts
// bad — "instead of a ternary the Boolean.match would be cleaner"; a one-line ternary stays
const type = event.type === 'text-delta'
	? 'text'
	: event.type === 'reasoning-delta'
		? 'reasoning'
		: 'unknown'

// good
Boolean.match(event.type === 'text-delta', {
	onFalse: () => 'reasoning',
	onTrue: () => 'text'
})
pipe(
	Match.value(props.layer),
	Match.when('claude', () => <ClaudeDark className={cn('size-3 shrink-0', props.className)} />),
	Match.when('codex', () => <CodexDark className={cn('size-3 shrink-0', props.className)} />),
	Match.exhaustive
)
```

```ts
// bad — "if there is an arg you must use the Effect.fn"
read: input => pipe(storage.read(input.id), Effect.withSpan('Todo.read', {attributes: {id: input.id}}))
const load = id =>
	Effect.gen(function* () {
		return yield* read(id)
	})

// good — fn with arguments, gen without
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage) {
	const input = yield* piUserMessage(message)
})
const stop = Effect.gen(function* () {
	if (!agent.state.isStreaming) return
	yield* setStatus('stopping')
})
```

```ts
// bad — "in most cases i don't have a default implementation"
class Logger extends Context.Service<Logger>()('Logger', {make: Effect.succeed(service)}) {}

export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('ledger/Ledger') {
	static readonly layer = Layer.effect(Ledger, makeLedger) // readonly
}
export declare namespace Ledger {
	export type Shape = {
		readonly add: (draft: LedgerDraft) => Effect.Effect<LedgerEntry, Schema.SchemaError> // readonly
	}
}
return Ledger.of({add, balanceByTag}) // identity wrapper

// good — service.ts holds the tag and the shape, internal/pi.ts the implementation
export declare namespace Ai {
	export type Agent = {
		events: Stream.Stream<Event>
		prompt: (message: Prompt.UserMessage) => Effect.Effect<void, AiError>
		stop: Effect.Effect<void>
	}
}
export class Ai extends Context.Service<Ai, Ai.Agent>()('@deslop/ai/service/Ai') {
	static layerPi(config: Pi.Config) {
		return Layer.effect(this, makePi(config))
	}
}
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('ledger/Ledger') {
	static layer = Layer.effect(this, makeLedger) // a property, never readonly
}
export const makePi = Effect.fnUntraced(function* (config: Pi.Config) {
	return {events: replay.events, prompt, status, stop} satisfies Ai.Agent
})
```

```ts
// bad — ".pipe" method
const Tag = Schema.String.pipe(Schema.check(Schema.isNonEmpty()))
const toolkit = yield* PiToolkit.pipe(Effect.provide(handlerContext))

// good — standalone pipe
trails: pipe(Schema.Array(PortfolioTrail), Schema.withConstructorDefault(Effect.succeed([]))),
const toolkit = yield* pipe(PiToolkit, Effect.provide(handlerContext))
```

```ts
// bad — hand-rolled what effect ships
const digits = BigDecimal.scale(BigDecimal.abs(amount), 2).value.toString().padStart(3, '0')
Schema.decode({decode: SchemaGetter.transform(String.toLowerCase), encode: SchemaGetter.passthrough()})

// good — node_modules/effect/dist is read before writing
BigDecimal.format(amount)
Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase()))
```

```ts
// bad — "malformed output fails instead of becoming empty data"
const content = yield * fs.readFileString(target).pipe(Effect.catchAll(() => Effect.succeed('')))
const config = yield * loadConfig.pipe(Effect.retry(Schedule.recurs(3)))

// good — "fail fast instead of retrying"; the error boundary handles it
const content = yield * fs.readFileString(target)
```

```ts
// bad — "Option sporadically, when it makes the code cleaner"
const value = input.value!
const parsed = Option.getOrUndefined(Number.parse(event.target.value))
if (parsed !== undefined) field.handleChange(parsed)

// good — a pipeline composes it; otherwise ?: undefined stays plain
Option.map(Number.parse(event.target.value), field.handleChange)
```

```ts
// bad — "not wrappers over the effect primitives, utils that compose with them"
class State {
	constructor(readonly ref: SubscriptionRef.SubscriptionRef<PortfolioState>) {}
	update(f: (s: PortfolioState) => PortfolioState) {
		return SubscriptionRef.update(this.ref, f)
	}
}
const traced = Effect.withSpan('Notes.create')(notes.create(input)) // rpcs and services already trace

// good — the primitive itself
const state = yield * SubscriptionRef.make(PortfolioState.make({}))
const connections = yield * Ref.make(HashMap.empty<string, number>())
```

```ts
// bad — "as functional and immutable as possible"
let total = 0
for (const value of values) total = total + value
items.push(item)

// good
const total = Number.sum(previous, value)
const next = Array.append(items, item)
Array.reduce(input.trails, HashMap.empty<string, Cell>(), (previousByVisitor, trail) => {
```

## Shape

```ts
// bad — "why is this extracted here? can't we just inline it?"
const random = Random.Random.defaultValue()

function randomIndex(length: number) {
	return Math.floor(random.nextDoubleUnsafe() * length)
}

// good
function randomIndex(length: number) {
	return Math.floor(Random.Random.defaultValue().nextDoubleUnsafe() * length)
}
```

```ts
// bad — "this is just a wrapper / factory function"
function isBackendRequest(request: IncomingMessage) {
	return isApiUrl(request.url)
}

// good — a predicate with two call sites
const isApiUrl = Predicate.compose(String.isString, Predicate.or(Equal.equals('/api'), String.startsWith('/api/')))
```

```ts
// bad — "wrapper function, tmp variable ... that can be inlined"
const run = () => Effect.gen(function* () { return yield* program })
const runPromise = Effect.runPromiseWith(Context.empty())
const endpoint = Schema.decodeUnknown(Endpoint)(config.endpoint)
client(endpoint)
return Ledger.of({add, balanceByTag, latest, load, summary})

// good
const run = program
static generateText = generateTextPi
pipe(config.endpoint, Schema.decodeUnknown(Endpoint), client)
return {events: replay.events, prompt, status, stop} satisfies Ai.Agent
```

```ts
// bad — "the code still keeps the compatibility/legacy code caused by the iterations"
export const create = createV2
export const createLegacy = createV1

// good — one construction path
static layerPi(config: Pi.Config) {
	return Layer.effect(this, makePi(config))
}
```

```ts
// bad — "things like the pollInterval shouldn't be configurable"
export type Config = {
	readonly remote: GitRemote
	readonly token: Secret.Secret
	readonly pollInterval: Duration.Duration
}

// good — only what the caller varies
export type Config = {main: AiAgentDefinition; model: AiModel; toolkit: Toolkit.Toolkit<Ai.Tools>}
```

## Quality

```ts
// bad — "why are we not disabling the cases with the ignore comments?"
files: ['packages/components/src/components/agent-browser.tsx', 'packages/components/src/components/form.tsx'],

// bad — "keep it enabled so other cases get fixed"
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {createServer} from 'node:http'

// good — the root cause removed
import {NodeRuntime} from '@effect/platform-node'
```

```ts
// bad — "this test is useless, it doesn't test that the agent is working"
it.layer(NodeServices.layer)('Pi', test => { // on internal/pi.ts
"./pi": "./src/internal/pi.ts",
it.effect('rejects an empty tag', () => // Schema.isNonEmpty already does
it.effect('loads', () => pipe(program, Effect.provide(Ledger.layer))) // per test

// good — "test files only for the services/packages public interfaces"; one layer
it.layer(NodeServices.layer)(testApi => {
	testApi.effect(
		'reports every project-specific invalid state',
		() => Effect.gen(function* () {
			const result = yield* lintSource({
```

## Natives

```ts
// bad — each line is a diagnostic
import {readFileSync} from 'node:fs'
const now = new Date()
const roll = Math.random()
const id = crypto.randomUUID()
const secret = process.env['SECRET']
const promise = fetch('https://example.com')
const timer = setTimeout(() => {}, 10)
console.log(stamp)

// good — Effect owns the capability
const fs = yield * FileSystem.FileSystem
const start = yield * Clock.currentTimeMillis
Random.Random.defaultValue().nextDoubleUnsafe()
host: (pipe(Config.string('HOST'), Config.withDefault('0.0.0.0')), Schedule.spaced(Duration.millis(55)))
yield * Effect.logInfo('Portfolio client connected')
```

## Globals and types

```ts
// bad — each line is a diagnostic
const keys = Object.keys({a: 1})
const map = new Map<string, number>()
const set = new Set<string>()
const biggest = Math.max(1, 2)
const first = items[0]!
type Holder = {value: ReadonlyArray<string>; time: Date; error: Error; done: Promise<void>}
type Wrapped = Readonly<{value: string}>
const entries = yield* Ref.make<readonly LedgerEntry[]>([])
interface Shape {
	readonly value: string
}
const inferrable: number = 1
const anyValue: any = 1
enum Color { Red }
const Point = Schema.Struct({x: Schema.Number})

// good
Record.toEntries({claude: claudeHome, codex: codexHome})
HashMap.empty<string, number>()
HashSet.fromIterable
const entries = yield* Ref.make(Array.empty<LedgerEntry>())
Option.flatMap(index => Array.get(input.program.body, index - 1))
type Holder = {value: string[]; time: DateTime.Utc; error: ToolExecutionError}
class ToolExecutionError extends Schema.TaggedError<ToolExecutionError>()('ToolExecutionError', {
const PortfolioVisitor = Schema.Struct({x: Schema.Finite, y: Schema.Finite})
```

## Expressions

```ts
// bad — each line is a diagnostic
const loose = '12' == 12
const orDefault = secret || 'none'
const empty = null
export const arrow = () => {
	return 1
}
if (!value) {
	return 'empty'
} else {
	return value
}
return value > 1 ? 'many' : value === 1 ? 'one' : 'none'
for (let index = 0; index < values.length; index++) {
	if (values[index] === 0) continue
}
input.value = 2
const unsorted = {b: 1, a: 2, c: 3}

// good
const root = options?.root ?? '.'
function randomIndex(length: number) {
export const layerNodeHttpServer = NodeHttpServer.layerConfig(createServer, {
	gracefulShutdownTimeout: Config.succeed('1500 millis'),
	host: pipe(Config.string('HOST'), Config.withDefault('0.0.0.0')),
	port: pipe(Config.port('PORT'), Config.withDefault(5000))
})
```

## Programs

```ts
// bad — each line is a diagnostic
const value = yield Effect.succeed(1)
try {
	return yield* Effect.succeed(value)
} catch {
	return 0
}
const run = Effect.runPromise(program)
Effect.gen(async function* () {
const chained = program.pipe(Effect.map(() => undefined))
const forwarding = () => Effect.gen(function* () { return yield* program })

// good — the owned runtime runs; pipe composes
NodeRuntime.runMain(
yield* pipe(decodeEvent(part), Effect.flatMap(replay.publish))
```

## Modules

```ts
// bad — each line is a diagnostic
import {useMemo} from 'react'
import {helper} from '../lib/utils.ts' // parent-relative; a sibling ./x.ts is fine
import {Ai} from '@deslop/ai/src/service.ts'
import {Schema} from 'effect' // used only as a type
export const Live = Effect.succeed(1)
export default helper

// good — subpath imports, import type, layers as static methods, every export has an importer
import type {PortfolioState, PortfolioTrail, PortfolioVisitor} from '#rpcs/contracts.ts'
import type {Connect, EnvironmentModuleNode, Plugin} from 'vite'
static layerPi(config: Pi.Config) {
```

## React

```ts
// bad — each line is a diagnostic
const fake = useState(() => ({current: null}))
const state = useState(0)
const ref = useRef<HTMLElement | null>(null)
const memo = React.useMemo(() => 1, [])

// good — React Compiler memoizes; Atom holds logic
const editorRef = useRef<Lexical.LexicalEditor>(null)
const [showShortcuts, setShowShortcuts] = useState(false)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
```
