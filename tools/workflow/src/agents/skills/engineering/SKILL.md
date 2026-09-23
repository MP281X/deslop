---
name: engineering
description: 'Use for product-code architecture, implementation, coding style, testing, or review.'
---

Write code to these rules; apply the repository's `project-engineering` skill where one exists. Both take precedence over a repository's other coding standards. Static analysis catches regressions; it never fixes code: every rule below is written correctly the first time, whether or not a linter checks it.

## Simplicity

Production code changes constantly; every line that is not needed now slows the next change. Build the smallest thing that does the requested job well:

- Doing less than asked beats doing more; name what you cut instead of building it.
- Happy path only. Handle an error or edge case only when the request or an existing contract requires it; otherwise let it fail.
- The core done well before breadth: a strong 70% beats a complete 100% with extras.
- No future-proofing: no option, parameter, layer, abstraction, export, file, script, or check for a need that does not exist yet. Inline until a second real use exists.
- A refactor replaces: delete superseded code, files, docs, tests, and exports in the same change; leave no compatibility path or leftover.
- Extend the nearest existing implementation of the same kind: mirror its permissions, errors, data refresh, and tests, and reuse its helpers instead of copying them.
- Change only the state an action changes: refresh, invalidate, or rerender nothing else.
- Touch only what the request needs; an unrelated improvement is a proposal for the user.
- Behave correctly instead of building machinery, such as hooks, guards, or generators, to enforce behavior.
- A mechanical pass preserves behavior and types; a pass that changes them is the user's decision.

```ts
// bad — "adding all those checks add complexity and i feel like it's not necessary"
if (!(yield * fs.exists(manifestPath))) return yield * new UninstalledAssetError({path: manifestPath})
const previous = yield * readReceipt('dual.openapi.json') // regeneration tracking nobody asked for
yield * fs.copyFile(configPath, `${configPath}.backup`) // "never backup previous configs"

// good — the requested behavior; a missing file fails on its own
yield * fs.writeFileString(configPath, rendered)
```

```tsx
// bad — a deploy Run button beside the Tests page's; three commits fixed the first
<Button onClick={openRunDialog}>Run</Button> // the sibling Run button sits behind the run permission
const runFailureMessage = (error: RunError) => error.descriptions.join('\n') // a copy of WorkflowRunError.failureMessage
queryClient.invalidateQueries({queryKey: workflowDeployKeys.detail(deployId)}) // a run changes runs, not the deploy
vi.mock('@tanstack/react-query') // a library; the network is the boundary
const fetch = vi.spyOn(globalThis, 'fetch') // shadows the global

// good — the sibling's shape, its helper reused, only the changed state refreshed, a real QueryClient
<PermissionGate permission="deploy_version.run"><Button onClick={openRunDialog}>Run</Button></PermissionGate>
WorkflowRunError.failureMessage(error)
queryClient.invalidateQueries({queryKey: organizationWorkflowRunKeys.all})
const fetchSpy = vi.spyOn(globalThis, 'fetch')
```

```ts
// bad — the generated package exports every schema, action, and client internal; consumers import two names
export * from './generated/Client.ts'
export * from './generated/Plugin.ts'

// good — only what a consumer imports
export {PetstorePlugin, PetstorePluginBase} from './generated/Plugin.ts'
```

```text
// bad — "code from previous iterations that isn't used or necessary anymore"
src/generator/resolve.ts, src/generator/referenceProblem.ts   // two $ref walkers after a rewrite
README.md, AGENTS.md, SKILL.md, sdk guide, changeset          // the same CLI flags five times
HANDOFF-openapi-plugin.md, ~/.ab/, eight stray worktrees      // artifacts left after "done"

// good — one walker, the CLI's --help as its documentation, and nothing left behind
src/generator/resolve.ts
```

```text
// bad — "It seems stupid and overcomplicated to have a script for it"
scripts/ask-gate.mjs     // a hook forcing the order of questions
guard.py                 // 100 lines enforcing three string checks
render-config.ts         // generates per-harness files from one source

// good — the instruction states the behavior; each harness keeps its own plain file
```

## Types

```ts
// bad — "are you sure this doesn't infer everything?"
fn: RpcClient.runtime.fn<{onSuccess: (message: string) => void}>()(
const Input = Schema.Struct({value: Schema.String}) satisfies Schema.Schema<Input>

// good — inferred; only a recursive function is annotated
Effect.gen(function* () {
	const decoded = yield* Schema.decodeEffect(LedgerFile)(yield* fs.readFileString(path))
	const balances = Array.reduce(decoded, HashMap.empty<Tag, BigDecimal.BigDecimal>(), sumByTag)
})
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
export type EntryDraft = {amount: EntryAmount; id?: EntryId; tag: string} // a hand-written shape beside the schema
const Tag = Schema.NonEmptyString // every schema, exported or not
const LedgerFile = Schema.fromJsonString(Schema.Array(LedgerEntry))

// good
export type AiAgent = typeof AiAgent.Type
export const AiAgent = Schema.Literals(['pi'] as const)
export type AiSessionId = typeof AiSessionId.Type
export const AiSessionId = Schema.Struct({agent: AiAgent, id: Schema.String})
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
```

```ts
// bad — "typeof X.Type is circular for a schema whose type passes through a Schema.suspend thunk naming X"
export type Step = typeof Step.Type
export const Step: Schema.Codec<Step> = Schema.Union([CallStep, CodeStep])
const StepArray: Schema.Codec<readonly Step[]> = Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step))

// good — every name on the cycle is a hand-written type; names off the cycle stay inferred; only the thunk is annotated; the union is declared after its members
export type CodeStep = typeof CodeStep.Type
export const CodeStep = Schema.Struct({code: Schema.String, kind: Schema.Literal('code')})
export type CallStep = {readonly do: readonly Step[]; readonly kind: 'call'}
export const CallStep = Schema.Struct({
	do: Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step)),
	kind: Schema.Literal('call')
})
export type Step = CallStep | CodeStep
export const Step = Schema.Union([CallStep, CodeStep])
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
Effect.gen(function* () {
	const manifest = yield* Schema.decodeEffect(PackageManifest)(yield* fs.readFileString(path))
})
```

```ts
// bad — "the schema .make method directly without wrapping it"
new AiError({message: 'The model returned no text'}) // the schema has make
function cursorFromBigInt(value: bigint) {
	return RunEventCursor.make(value.toString())
}
function checked(value: bigint) {
	if (value < 0n) throw new Error('negative')
	return RunEventCursor.make(value.toString())
}

// good — the schema owns validation and defaults
return Effect.fail(AiError.make({message: `Pi does not support ${part.mediaType} prompt parts`}))
```

## Effect

```ts
// bad — "you shouldn't manually decode json without effect schema"
const raw: unknown = JSON.parse(body)
const payload = Schema.decodeUnknownSync(RequestPayload)(raw)
const count = parseInt(input.count)
commits.map(commit => commit.subject) // in tests too
typeof value === 'string' // Predicate.isString

// good — Schema, Array, String, Number, Predicate over globals
Schema.decodeEffect(PackageManifest)(text) // PackageManifest is a fromJsonString schema
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

// good — a one-line ternary, Boolean.match for a boolean, Match for a union
aria-current={props.selected === true ? 'page' : undefined}
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

Math.floor(Duration.toDays(DateTime.distance(oldest.timestamp, newest.timestamp)))

// good — node_modules/effect/dist is read before writing
BigDecimal.format(amount)
Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase()))
Duration.parts(DateTime.distance(oldest.timestamp, newest.timestamp)).days
Array.match(lines, {onEmpty: () => Option.none(), onNonEmpty: lines => Option.some(Array.join(lines, '\n'))})
```

```ts
// bad — "malformed output fails instead of becoming empty data"
Effect.gen(function* () {
	const content = yield* pipe(
		fs.readFileString(target),
		Effect.catch(() => Effect.succeed(''))
	)
	const config = yield* pipe(loadConfig, Effect.retry(Schedule.recurs(3)))
})

export class LedgerError extends Data.TaggedError('LedgerError')<{readonly reason: string}> {}
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped, new
load: (path: string) => Effect.Effect<void, PlatformError | Schema.SchemaError> // library failures leak from the service

// good — "fail fast instead of retrying"; one domain error per service in schema.ts, cause kept, no catch
export class AiError extends Schema.TaggedError<AiError>()('AiError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
const load = Effect.fn('Ledger.load')(
	function* (path: string) {},
	Effect.mapError(cause => AiError.make({cause, message: 'Cannot load the ledger'})) // the pipeline argument of fn, no .pipe after it
)
prompt: (message: Prompt.UserMessage) => Effect.Effect<void, AiError>
Effect.gen(function* () {
	const content = yield* fs.readFileString(target)
})
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
Effect.gen(function* () {
	const state = yield* SubscriptionRef.make(PortfolioState.make({}))
	const connections = yield* Ref.make(HashMap.empty<string, number>())
})
```

```ts
// bad — acquisition and release with different owners
Effect.gen(function* () {
	const socket = yield* openSocket
	yield* Effect.addFinalizer(() => closeSocket(socket))
})

// good — one scope owns the lifetime
Effect.gen(function* () {
	const webSocketServer = yield* Effect.acquireRelease(openSocket, closeSocket)
})
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
	return random.nextIntUnsafe() % length
}

// good
function randomIndex(length: number) {
	return Random.Random.defaultValue().nextIntUnsafe() % length
}
```

```ts
// bad — "this is just a wrapper / factory function"
function isBackendRequest(request: IncomingMessage) {
	return isApiUrl(request.url)
}

// good — a predicate, reused
const isApiUrl = Predicate.compose(
	String.isString,
	Predicate.or(Equal.equals('/api'), Predicate.or(String.startsWith('/api/'), String.startsWith('/api?')))
)
```

```ts
// bad — "wrapper function, tmp variable ... that can be inlined"
const run = () => Effect.gen(function* () { return yield* program })
const runPromise = Effect.runPromiseWith(Context.empty())
const endpoint = Schema.decodeUnknown(Endpoint)(config.endpoint)
client(endpoint)
return Ledger.of({add, balanceByTag, latest, load, summary})
Ref.set(entries, Array.copy(decoded)) // decoded is already an array

// good
const run = program
static generateText = generateTextPi
pipe(config.endpoint, Schema.decodeUnknown(Endpoint), client)
return {events: replay.events, prompt, status, stop} satisfies Ai.Agent
Ref.set(entries, decoded)
```

```ts
// bad — a function that reads no argument is a value
const notFound = () => HttpServerResponse.empty({status: 404})
return notFound()

// good — the value itself, named once
const notFound = HttpServerResponse.empty({status: 404})
return notFound
```

```ts
// bad — "the code still keeps the compatibility/legacy code caused by the iterations"
export const createLegacy = createV1 // kept for callers nobody has

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
it.effect('rejects an empty tag', () => run(ledger.add({tag: ''}))) // Schema.isNonEmpty already does
it.effect('fails on a malformed amount', () => run(ledger.load(malformed))) // BigDecimalFromString already does
it.effect('loads', () => pipe(program, Effect.provide(Ledger.layer))) // the layer, per test
assert.deepStrictEqual(Array.map(commits, commit => DateTime.formatIso(commit.timestamp)), stamps) // Schema decoded it
vi.mock('../src/NotionClient.ts', () => ({})) // a Layer is the seam

// good — "test files only for the services/packages public interfaces"; one layer; a test asserts a value the brief specifies, never one a library computes
it.layer(Layer.provideMerge(Ledger.layer, NodeServices.layer))(test => {
	test.effect('keeps the previous entries when the file is malformed', () => run(program)) // the no-partial-data decision
	test.effect('sums expenses negative per tag', () => run(program))
})
it.layer(NodeServices.layer)(test => {
	test.effect('reports every project-specific invalid state', () =>
		Effect.gen(function* () {
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
Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const start = yield* Clock.currentTimeMillis
	yield* Effect.logInfo('Portfolio client connected')
})
Random.Random.defaultValue().nextDoubleUnsafe()
Schedule.spaced(Duration.millis(55))
pipe(Config.string('HOST'), Config.withDefault('0.0.0.0'))
Config.redacted('SMTP_PASS') // a secret is Redacted, never a string
```

```ts
// bad — the ternary restates what Array.ensure already decides
const recipients = Array.isArray(input) ? input : [input]

// good
const recipients = Array.ensure(input)
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
type PortfolioVisitor = typeof PortfolioVisitor.Type
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
const render = (commits: Commit[]) => pipe(commits, Array.map(renderCommit)) // a declaration, at module scope
const commitLine = /^(?<type>\S+): (?<subject>.+)$/ // the u flag
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
String.replaceAll(/[-_]+/gu, ' '),
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
export const EntryKind = Schema.Literals(['income', 'expense']) // no importer
export default helper

// good — subpath imports, import type, layers as static methods, every export has an importer
import type {PortfolioState, PortfolioTrail, PortfolioVisitor} from '#rpcs/contracts.ts'
import type {Connect, EnvironmentModuleNode, Plugin} from 'vite'
static layerPi(config: Pi.Config) {
```

## Package

```
// bad — "improve the folder/files structure, I hate it"
tools/oxlint-rules/                       // rules apart from their config
  src/oxlint-plugin.ts                    // ten rules in one file
  src/oxlint-plugin.test.ts
  package.json
  tsconfig.json
tools/workflow/
  assets/                                 // source beside src
    claude/output-styles/pair.md, settings.json, agents/*.md
    codex/AGENTS.md, config.toml, agents/*.toml
    skills/engineering/SKILL.md
  src/main.ts                             // name says nothing
  package.json                            // scripts and exports nothing consumes

// good
tools/workflow/
  src/
    agents/
      claude/output-styles/pair.md, settings.json, agents/*.md
      codex/AGENTS.md, config.toml, agents/*.toml
      skills/engineering/SKILL.md
    rules/<rule>.ts, shared.ts, rules.test.ts    // one file per rule, test beside
    oxlint.ts                                    // config named, plugin default
    install.ts
  tsconfig.json                                  // exported base
  package.json                                   // files, exports, bin, one script
```

## React

```ts
// bad — each line is a diagnostic
const fake = useState(() => ({current: null}))
const state = useState(0) // not destructured
const ref = useRef<HTMLElement | null>(null)
const memo = React.useMemo(() => 1, [])

// good — React Compiler memoizes; Atom holds logic
const editorRef = useRef<Lexical.LexicalEditor>(null)
const [showShortcuts, setShowShortcuts] = useState(false)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
```
