---
name: engineering
description: 'TypeScript and Effect code conventions paired with shared lint. Use when designing, implementing or reviewing product/test code, including prototypes.'
---

**Scope.** Apply these rules and repository-specific CODING_STANDARDS.md.

**Dependency APIs.** Match the manifest and lockfile versions. Before adding an API wrapper or workaround, read the upstream source per workflow's research procedure. Library APIs do not define coding policy.

**Diagnostics.** Use the shown idiom, not casts, weakened rules or a rewrite trading one diagnostic for another.

## Simplicity

**Clarity.** Plain, explicit, idiomatic code, names and files; read top to bottom without commentary or cleverness. Match the surrounding code's naming, idiom and comment density.

**Experiments.** Write with these idioms; reserve the full refactor/cleanup pass for retained delivery. Keep disposable source isolated and shared rules intact.

- **Reuse first.** Check existing code, installed modules and platform capabilities before adding code. Implement only the missing behavior, without dropping required behavior, safety or accessibility. Workflow owns the scope. A refactor or cleanup request applies every rule to every line of the owned files.
- **Inward layers.** Domain and service code never import HTTP, RPC, or other transport types.
- **Building blocks.** For a consequential new interface, start with a realistic caller operation and its ordering, failure and lifetime obligations; hide useful complexity, not forwarded names. Offer services, Layers and functions the caller composes like any Effect module, never a bundle such as `serve(app)`. No mandatory architecture document or alternatives round.
- **No machinery.** Add hooks, guards or generators only for a required contract or a recurring defect.
- **Behavior kept.** A refactor keeps observable behavior at every consumer. Report accepted differences only when they exist: a change no consumer observes, or one a rule here causes, such as an error keeping its cause. Printed diagnostics are not a contract. Any other behavior change follows workflow's scope.
- **Reachable bugs.** Fix a bug that real input reaches when it lies inside workflow's scope, and check every consumer of the changed output. For a hard bug, use one reproduction and one prediction per probe. Remove edits based on disproven hypotheses, then rerun the original scenario. Delete handling only for input the contract excludes; keep and report code that looks intentional.
- **Performance.** Optimize only when the request or a required contract needs it, and measure realistic input before claiming a speedup. Diagnose at the layer that owns the symptom: distributed spans for RPC/backend dependencies, React commits for rerenders, a browser performance profile for main-thread work. Correlate one real action before changing code, then repeat it on the fix; neither a screenshot nor a service name proves latency or trace coverage. Time correct completed work under equivalent workloads/configuration; distinguish setup/cache/profiling cost and report run count/variation. Differences within noise are unproved, not speedups. Use existing instrumentation; profiling is not a ritual on every change.
- **Type safety.** A fix never weakens types to make a symptom go away: no widened or erased type, cast, dropped generic, or loosened exported type.
- **Domain.** Implement the definition the domain uses, such as a cycle for recursion, never the nearest syntactic proxy.

**Happy path.** Failures flow through the error channel: no catch, retry, fallback, backup, or defensive check unless the request or an existing contract needs it.

**Trusted data.** Validate and transform once at the boundary with Effect Schema. Carry narrowed values forward. Never re-check what the schema, the declared type, an earlier filter or every caller guarantees.

```ts
// good
const add = Effect.fn('Ledger.add')(function* (draft: LedgerDraft) {
	yield* Ref.update(entries, Array.append(draft))
})
// bad
Schema.decodeEffect(LedgerDraft)(draft) // draft is already a LedgerDraft
variable.init?.type === 'TSSatisfiesExpression' // init was already narrowed to non-null
```

**Effect first.** Search matching cloned Effect modules before hand-writing traversal, state, configuration or platform operations. Replace dependencies covered by Effect or its platform adapters.

```ts
// good
const cycles = Graph.stronglyConnectedComponents(graph)
BigDecimal.format(amount)
Duration.parts(DateTime.distance(oldest.timestamp, newest.timestamp)).days
fs.glob('**/.env*.example', {exclude: ['**/node_modules'], root: config.cwd})
// bad
const digits = BigDecimal.scale(BigDecimal.abs(amount), 2).value.toString().padStart(3, '0')
Math.floor(Duration.toDays(DateTime.distance(oldest.timestamp, newest.timestamp)))
import {glob} from 'glob' // a dependency Effect's FileSystem replaces
```

**Whole values.** Pass whole values or spread them. Do not destructure parameters, callbacks or loop bindings, except labeled tuple parameters, React state and component refs. Project fields only to exclude data the recipient must not receive. Name the whole value by its role. A leading underscore marks only a parameter the body never reads; never add an underscore or a number to avoid shadowing.

```ts
// good
server => ({server: {...server, forwardConsole: true, warmup}})
for (const schema of schemas) report(schema.name)
Record.map(groups, entries => entries.length)
upload({scope: input.scope, type: input.type}) // input also holds the bearer token
submission => onSubmit(submission.value)
// bad
({host, port}) => ({server: {forwardConsole: true, host, port, warmup}})
server: {forwardConsole: true, host: config.host, port: config.port, warmup}
for (const {name} of schemas) report(name)
Array.map(Record.toEntries(groups), ([key, entries]) => entries.length)
_input => onSubmit(_input.value) // or input2: an outer input is shadowed
```

**Nearest sibling.** Extend the nearest implementation; match permissions, errors, refresh and tests. Reuse its helpers and change only affected state.

**Once.** Extract repeated logic once; one fact has one owner.

```ts
// good
const sandboxGone = Effect.mapError(cause => SandboxError.make({cause, message: 'The sandbox is gone'}))
// bad — the same mapping written in three handlers
pipe(
	sandbox.exec(input),
	Effect.mapError(cause => SandboxError.make({cause, message: 'The sandbox is gone'}))
)
pipe(
	sandbox.read(path),
	Effect.mapError(cause => SandboxError.make({cause, message: 'The sandbox is gone'}))
)
```

**Canonical data.** Store/send canonical data, derive display values, expose each state once and remove states no caller produces.

**One way.** Replace superseded paths; no duplicate/subset/superset fields, methods, options or exports.

**No compatibility.** Rename the shape and every caller together. No alias, fallback, deprecated path or flag unless a documented/user-named contract requires it.

**Present needs.** No speculative option, abstraction, layer, export, file or check. Configure only what callers vary.

**Dead code.** Every superseded or unused file, export, type, branch, config, validation, doc, test, and dependency goes in the same change.

## Lint pairs

The forms below are the ones lint enforces without an autofix, each in a form that satisfies every rule involved.

**Fallback.** A default is `??`; never a ternary on the same value.

```ts
// good
const root = options?.root ?? '.'
// bad — no-negated-condition flips it, then prefer-nullish-coalescing flags it
const root = options?.root !== undefined ? options.root : '.'
```

**Conditions.** A boolean is tested bare; `=== true` only on a value that can be undefined.

```tsx
// good
if (enabled) return
aria-current={props.selected === true ? 'page' : undefined}
// bad
if (enabled === true) return // enabled is a boolean
if (props.selected) return // props.selected can be undefined
```

**Flat.** Use early-return statements in Effect.fn. No nested ternaries or combinators deeper than equivalent statements. Match/combinators serve single expressions; Boolean.match selects a value, except one-line JSX-attribute ternaries.

```ts
// good
const kill = Effect.fn('Sandbox.kill')(function* (sandbox?: Sandbox) {
	if (sandbox?.status !== 'running') return

	yield* sandbox.kill
})
Boolean.match(ignoreCase, {onFalse: () => undefined, onTrue: () => 'i'})
// bad
const type = event.type === 'text-delta' ? 'text' : event.type === 'reasoning-delta' ? 'reasoning' : 'unknown'
const flags = ignoreCase ? 'i' : undefined // "instead of a ternary the Boolean.match would be cleaner"
// bad
Array.appendAll(
	base,
	Boolean.match(hasTools, {
		onFalse: () => [],
		onTrue: () =>
			pipe(
				tools,
				Array.map(tool => pipe(tool, Option.toArray))
			)
	})
)
```

**Choices.** `Match` for a union, never `switch`.

```ts
// good
pipe(
	Match.value(usage.kind),
	Match.when('input', () => 'in'),
	Match.when('output', () => 'out'),
	Match.exhaustive
)
// bad
switch (usage.kind) {
	case 'input':
		return 'in'
}
```

**Options.** Use Option operators, never .value. Use Option where it composes; keep plain optional values otherwise. This is our convention, not a claim narrowing is unsafe.

```ts
// good
Option.map(Number.parse(event.target.value), field.handleChange)
Option.map(Array.head(parts), part => part.text)
// bad
if (Option.isSome(open)) open.value.append(event.delta)
const parsed = Option.getOrUndefined(Number.parse(event.target.value))
```

**Handlers.** A handler used once is an arrow in place; a handler used twice is a `function`.

**Pairs.** Read positional tuples by index. Whole values lists the destructuring exceptions.

**Accumulators.** No `let`: a fold or an Effect collection operation that says what it selects.

```ts
// good
const total = Array.reduce(values, 0, Number.sum)
pipe(teamId, String.split(','), Array.map(String.trim), Array.findFirst(String.isNonEmpty))
Array.filterMap(items, item =>
	Boolean.match(supports(item), {onFalse: () => Result.failVoid, onTrue: () => Result.succeed(item.value)})
)
// bad
let total = 0
for (const value of values) total += value
const [first] = teamId
	.split(',')
	.map(value => value.trim())
	.filter(value => value.length > 0)
items.filter(item => supports(item)).map(item => item.value)
```

**Natives.** Use Effect modules instead of globals/native methods. Third-party-owned methods stay, with an inline diagnostic disable and reason when needed.

```ts
// good
Number.parse(input.count)
Predicate.isString(value)
Predicate.isNotNullish(annotation)
Array.isReadonlyArrayEmpty(node.arguments)
String.isNonEmpty(event.delta)
Array.get(items, 0)
const serve = Effect.gen(function* () {
	const start = yield* Clock.currentTimeMillis
	const host = yield* pipe(Config.String('HOST'), Config.withDefault('0.0.0.0'))
	const password = yield* Config.Redacted('SMTP_PASS')
	yield* Effect.sleep(Duration.millis(delay))
	return {host, password, start}
})
// bad
parseInt(input.count)
typeof value === 'string'
annotation !== null && annotation !== undefined
node.arguments.length === 0
Effect.promise(() => new Promise(resolve => setTimeout(resolve, delay)))
process.env.HOST ?? '0.0.0.0'
```

**Pipe.** A standalone `pipe`, nested at most three deep; never the `.pipe` method.

**Failures.** Yield a yieldable domain error directly in a generator: `return yield* E.make(...)`. Keep `Effect.fail(error)` when the error is not yieldable; outside a generator, use `Effect.fail`. Do not infer yieldability from factory-call syntax.

```ts
// good
const text = Effect.fn('Ai.text')(function* (response: AiResponse) {
	if (response.status === 'refused') return yield* AiError.make({message: 'The model refused the prompt'})

	return response.text
})
// bad
const text = Effect.fn('Ai.text')(function* (response: AiResponse) {
	if (response.status === 'refused') yield* Effect.fail(AiError.make({message: 'The model refused the prompt'}))
	if (response.status === 'refused') throw new Error('The model refused the prompt')
	return response.text
})
```

**Casts.** No `as`, `any` or erasing a known shape into `unknown`; `satisfies` and `as const` are the only assertions. Genuinely opaque SDK/framework inputs remain `unknown` until narrowed or decoded at their boundary—do not fabricate a shape to avoid that type.

```ts
// good
const params = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(part.params)
return Effect.succeed([{text: part.text, type: 'text'} satisfies TextContent])
// bad — a cast satisfies one rule and the next flags it
const params = part.params as Record<string, unknown>
const params: unknown = part.params // erases an already-known shape
```

**Decoders.** `Schema.decodeUnknownEffect` only for `unknown` input; typed input uses `Schema.decodeEffect`, and JSON text goes through `Schema.fromJsonString`.

```ts
// good
const load = Effect.fn('Plugin.load')(function* (path: string) {
	const endpoint = yield* Schema.decodeEffect(Endpoint)(config.endpoint)
	const manifest = yield* Schema.decodeEffect(PackageManifest)(yield* fs.readFileString(path))
	return {endpoint, manifest}
})
// bad
Schema.decodeUnknownEffect(Endpoint)(config.endpoint) // config.endpoint is a string
JSON.parse(text)
```

**Imports.** Keep module names; only generated shadcn aliases differ. Separate type imports; packages, blank line, then # aliases. Every export has a consumer.

```ts
// good
import {Effect, Schema} from 'effect'
import type {Plugin} from 'vite'

import type {PortfolioState} from '#rpcs/contracts.ts'
// bad — each line is a diagnostic
import {Schema as S} from 'effect'
import {type Plugin, createServer} from 'vite'
export const EntryKind = Schema.Literals(['income', 'expense']) // no importer
```

**Readonly.** Required on service-shape properties. Allowed on class members and handwritten `Schema.suspend` cycle types; otherwise forbidden.

**Disables.** Fix the idiom or reproduce a rule defect. Inline disables require an unavoidable conflict and -- reason; never disable ordering or weaken file configuration. Report dependency-only diagnostics; rename filename violations.

```ts
// good
// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack Router augments this interface by name.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite's plugin API hands over a Node server.
// bad
"exactOptionalPropertyTypes": false
// oxlint-disable-next-line typescript/consistent-type-assertions
// oxlint-disable-next-line sort-keys -- keeps the printed order
// bad
files: ['packages/components/src/components/dev-tools.tsx', 'packages/components/src/components/form.tsx'],
```

## Effect

**Functions.** Use Effect.fn('Name.method') for a traced function with arguments and Effect.fnUntraced for an internal helper. Use Effect.gen for an effect with several statements and no arguments, and a single effect directly. Use Effect.fn.Return for an explicit return type.

```ts
// good
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage): Effect.fn.Return<void, AiError> {
	const input = yield* piUserMessage(message)
	yield* send(input)
})
const decodePart = Effect.fnUntraced(function* (part: Part) {
	return yield* Schema.decodeEffect(Event)(part)
})
const stop = Effect.gen(function* () {
	yield* setStatus('stopping')
	yield* kill
})
const restart = setStatus('starting')
// bad
fetch: url => Effect.tryPromise(() => fetch(url))
const decodePart = Effect.fn('decodePart')(function* (part: Part) {}) // a span on an internal helper
const stop = Effect.gen(function* () {
	yield* setStatus('stopping')
}) // one statement
```

**Errors.** One domain error per service; preserve cause, redact secrets, map in Effect.fn's pipeline argument. Map SDK unknown errors at the adapter.

```ts
// good
export class AiError extends Schema.TaggedError<AiError>()('AiError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
const prompt = Effect.fn('Ai.prompt')(
	function* (message: Prompt.UserMessage) {
		yield* send(message)
	},
	Effect.mapError(cause => AiError.make({cause, message: 'Cannot prompt the agent'}))
)
const pages = Effect.tryPromise({
	catch: cause => NotionError.make({cause, message: 'Cannot list pages'}),
	try: () => client.pages.list()
})
Effect.mapError(cause => WorkspaceError.make({cause: Redacted.make(cause), operation: 'exec input'}))
Effect.tapError(() => cleanup)
// bad
pipe(
	fs.readFileString(target),
	Effect.catch(() => Effect.succeed(''))
)
pipe(loadConfig, Effect.retry(Schedule.recurs(3)))
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped, new
Effect.catch(error => pipe(cleanup, Effect.andThen(Effect.fail(error)))) // fails again with the error it caught
load: (path: string) => Effect.Effect<void, PlatformError | Schema.SchemaError> // library failures leak from the service
```

**Services.** Inline a sole implementation in its Layer; name layers for multiple backends. Defaults use Context.Reference. Implement with Service.of or satisfies; service methods are readonly properties.

```ts
// good
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('@app/ledger/service/Ledger') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const entries = yield* Ref.make(Array.empty<LedgerEntry>())
			return Ledger.of({add: add(entries), balanceByTag: balanceByTag(entries)})
		})
	)
}
export class Ai extends Context.Service<Ai, Ai.Agent>()('@app/ai/service/Ai') {
	static layerPi(config: Pi.Config) {
		return Layer.effect(this, makePi(config))
	}
}
export const Verbose = Context.Reference<boolean>('@app/ai/Verbose', {defaultValue: () => false})
// bad
class Logger extends Context.Service<Logger>()('Logger', {make: Effect.succeed(service)}) {}
static readonly layer = Layer.effect(Ledger, makeLedger) // a make with one caller
query(sql: string): Effect.Effect<Rows> // a method signature instead of a readonly property
```

**Primitives.** Use Effect's primitives directly; rpcs and services already trace, and one scope owns each lifetime. Compose established independent I/O with Effect.all and explicit appropriate concurrency; keep order-dependent, transactional or resource-conflicting work sequential.

```ts
// good
const connect = Effect.gen(function* () {
	const state = yield* SubscriptionRef.make(PortfolioState.make({}))
	const socket = yield* Effect.acquireRelease(openSocket, closeSocket)
	return {socket, state}
})
// bad
class State {
	update(f: (s: PortfolioState) => PortfolioState) {
		return SubscriptionRef.update(this.ref, f)
	}
}
const traced = Effect.withSpan('Notes.create')(notes.create(input))
Effect.addFinalizer(() => closeSocket(socket)) // acquisition and release with different owners
```

**Runtime.** The owned runtime runs the program; a Promise an external contract demands is bridged once, where it is returned. React code is no such contract: atoms run its Effects.

```ts
// good
NodeRuntime.runMain(program)
health: flow(rpc.health, Effect.runPromiseWith(Context.empty())),
// bad
const runtime = ManagedRuntime.make(AppLayer)
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
```

**Sorting.** `Order` for sorting, `Result` for a fallible pure value.

```ts
// good
Array.sort(
	entries,
	Order.mapInput(Order.Number, entry => entry.tokens)
)
Result.fromOption(Array.head(parts), () => AiError.make({message: 'The model returned no parts'}))
// bad
entries.sort((left, right) => left.tokens - right.tokens)
```

## Types and Schema

**Inference.** Infer types. Annotate recursion or branches TypeScript cannot unite; use schema types/indexed members in signatures. Keep intentional widening, not repeated inferred generics.

```ts
// good
const balances = Array.reduce(decoded, HashMap.empty<Tag, BigDecimal.BigDecimal>(), sumByTag)
const label = MutableRef.make('') // the initializer infers string, not just ''
const [status, setStatus] = useState<'idle' | 'running'>('idle') // intentional widening
function visit(node: Node): Result {
	return visit(node.parent)
}
function settle(amount: LedgerEntry['amount']) {
	return BigDecimal.format(amount)
}
export type Sandbox = ReturnType<typeof fromSdk>
// bad
const Input = Schema.Struct({value: Schema.String}) satisfies Schema.Schema<Input>
const label = MutableRef.make<string>('') // repeats the inferred type
export type SandboxLike = {id: string; renew: (seconds: number) => Promise<unknown>} // a copy of an inferred shape
```

**Schema pairs.** Type pair immediately before every schema. Structs use Schema.Struct, never Schema.Class; reuse fields by spreading. Use Schema.optionalKey for absent fields; Schema.optional allows explicit undefined too, so reserve it for that contract.

```ts
// good
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
RunEventCursor.make(value.toString())
trails: pipe(Schema.Array(PortfolioTrail), Schema.withConstructorDefault(Effect.succeed([])))
// bad
export type EntryDraft = {amount: EntryAmount; id?: EntryId; tag: string} // a hand-written shape beside the schema
// bad
new AiError({message: 'The model returned no text'}) // the schema has make
function cursorFromBigInt(value: bigint) {
	return RunEventCursor.make(value.toString())
}
payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'name', 'x', 'y']))) // the schema itself fits
```

**Construction.** `schema.make` applies defaults and validates synchronously, throwing on failure; use it for trusted construction. For reachable fallible construction with defaults, use `schema.makeEffect` and map its `SchemaIssue.Issue` to the owning domain error. Effect decoders report `SchemaError`; use the correct error contract and do not revalidate already-narrowed data.

```ts
// good — reachable constructor failure stays in the error channel
pipe(
	Name.makeEffect(input),
	Effect.mapError(cause => NameError.make({cause, message: 'Invalid name'}))
)
// bad — input can fail a refinement even though its TypeScript type is string
Name.make(input)
```

**Cycles.** Handwrite each recursive-cycle type; annotate only Schema.suspend thunks. Noncycle types stay inferred; unions follow members.

```ts
// good
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

**Error predicates.** A predicate is a static member of its tagged error; a struct is checked inline with `Schema.is`.

```ts
// good
class PathNotFound extends Schema.TaggedError<PathNotFound>()('PathNotFound', {
	cause: Schema.optional(Schema.Defect())
}) {
	static matches = (error: Cause.UnknownError) => Schema.is(FileNotFound)(error.cause)
}
// bad
function isPathNotFound(error: unknown) {
	return Schema.is(FileNotFound)(error)
}
```

## Shape

**Inline.** Inline forwarding wrappers and single-use helpers/temporaries/constants. Argument-free functions are named values.

```ts
// good
function randomIndex(length: number) {
	return Random.Random.defaultValue().nextIntUnsafe() % length
}
const isApiUrl = Predicate.compose(String.isString, Predicate.or(Equal.equals('/api'), String.startsWith('/api/'))) // a predicate, reused
static generateText = generateTextPi
const notFound = HttpServerResponse.empty({status: 404})
// bad
const random = Random.Random.defaultValue()
function isBackendRequest(request: IncomingMessage) {
	return isApiUrl(request.url)
} // "this is just a wrapper / factory function"
Ref.set(entries, Array.copy(decoded)) // decoded is already an array
const runPromise = Effect.runPromiseWith(Context.empty()) // "wrapper function, tmp variable ... that can be inlined"
```

**Linked state.** Linked state moves in one pure updater, never a setter that calls another.

```ts
// good
setState(current => {
	const draft = {...current.draft, files}
	return {draft, owner: ownerAfter(draft)}
})
// bad
setDraft(current => {
	setOwner(ownerAfter(current))
	return {...current, files}
})
```

**File tree.** Use explicit kebab-case role names and one naming scheme. Prefer one substantive file to near-empty fragments; colocate <name>.test.ts; no barrels.

**Package surface.** Declare exports for imported subpaths and import aliases for internal paths. Use the shared lint preset with generated ignores only.

```ts
// good
"exports": {"./plugin": "./src/generated/plugin.ts"}
export {oxlint as default} from '@deslop/coding-standards'
// bad — consumers import two names from a barrel of everything
export * from './generated/Client.ts'
const warned = ['sort-keys', 'typescript/no-restricted-types'] // a package rule list
"typecheck": "tsc --noEmit" // type-aware lint already checks types
```

**Generated code.** A generator emits code that follows these rules as closely as it can; lint ignores its output.

## React

**Components.** React Compiler memoizes. Destructure state at its declaration, receive component refs through props, and keep only a component's own interaction state in React.

```tsx
// good
const editorRef = useRef<Lexical.LexicalEditor>(null)
const [showShortcuts, setShowShortcuts] = useState(false)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
// bad
const handle = useCallback(() => setOpen(true), [])
const state = useState(false)
```

**Atoms.** Data, shared state and every Effect a component needs live in atoms; a component reads them with hooks and never runs an Effect. A task that changes a React Query hook, a fetching Effect or an Effect runner in React code moves that code to an atom. Declare atoms at module level or in `Atom.family`, never during render. Import `Atom` and `AsyncResult` from `effect/reactivity` and the hooks from `@effect/atom-react`. Supply services through `Atom.runtime(layer)`, and tie each write to the reads it changes with reactivity keys.

```tsx
// good
const appsRuntime = Atom.runtime(DualApps.layer)
const appAtom = Atom.family((id: AppId) => pipe(appsRuntime.atom(loadApp(id)), Atom.withReactivity(['apps'])))
const saveAppAtom = appsRuntime.fn((draft: AppDraft) => saveApp(draft), {reactivityKeys: ['apps']})
const app = useAtomValue(appAtom(appId))
const [saveResult, save] = useAtom(saveAppAtom)
// bad
useQuery({queryFn: () => Effect.runPromiseWith(Context.empty())(loadApp(appId))})
onClick={() => Effect.runPromise(saveApp(draft))}
useAtomValue(Atom.make(loadApp(appId))) // a new atom on every render
```

**Outcomes.** Render every `AsyncResult` state: loading, failure with its recovery, and success. Take a write's pending and failure state from its atom's result, never from copied React state.

```tsx
// good
AsyncResult.match(app, {
	onFailure: failure => <LoadError cause={failure.cause} onRetry={refresh} />,
	onInitial: () => <Spinner />,
	onSuccess: success => <AppFrame app={success.value} />
})
<Button disabled={saveResult.waiting} onClick={() => save(draft)}>Save</Button>
// bad
app.data ? <AppFrame app={app.data} /> : <Spinner /> // a failed load spins forever
const [pending, setPending] = useState(false) // copies the write atom's waiting state
```

- **Ownership.** Give a component that owns its own atoms, writes or lifetime its own file; keep small presentational helpers beside their one user. Reset an editable draft through a `key` on its identity, never an Effect that copies props.
- **Pure render.** Derive display values from props and subscribed state during render; never mutate them or perform an RPC, write or subscription there. Event handlers own user-triggered actions; Effects synchronize external systems, not copied state or calculations. Reuse the existing router/atom integration rather than fetching in a new Effect.
- **State identity.** Keep one owner for each value, stable domain keys for list items and deliberate reset boundaries. For an observed rerender problem, derive the needed value in the existing atom graph instead of subscribing to frequently changing unrelated state. Compiler memoization is a performance optimization, never a correctness or lifetime guarantee. Do not add manual memoization, compiler escape directives or weakened hook rules to hide an ownership problem.

Testing judgment, fixtures, assertions and verification belong to the testing skill; these engineering rules still apply to test code.
