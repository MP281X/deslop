---
name: engineering
description: 'Engineering rules for product code, paired with the shared lint. Use before designing or editing code, writing tests, or reviewing a diff.'
---

Apply the repository's CODING_STANDARDS.md alongside these rules; where the two conflict or leave a case open, this skill wins, and both win over any other coding guidance. The deslop codebase is the bar for structure and consistency in every repository. Every good example passes the shared lint and format as written, so write each form right the first time: lint is the fallback. When lint flags code written from this skill, the block for that rule is the fix; never a cast, and never a rewrite that trades one diagnostic for another. Effect's source is the installed one, in `node_modules/effect/src` and `node_modules/@effect/*/src`.

Each rule is one block: a leading word, the rule, then the good form and the bad one with the user's words. A rule with no code form is a bullet.

## Simplicity

Everything you produce, code, names, files, tests, and the diff a reviewer reads, is understood at first glance: plain, explicit, idiomatic, readable top to bottom, with no comments and nothing clever. Every line not needed now slows the next change.

- **Requested only.** Build the smallest thing that does the requested job well and touch only what the request needs; an unrelated improvement is listed for the user. A refactor or cleanup request asks for depth instead: every rule applies to every line of the owned files.
- **Inward layers.** Domain and service code never import HTTP, RPC, or other transport types.
- **Building blocks.** Offer services, Layers, and functions the caller composes like any Effect module, never a wrapper that bundles them behind one call such as `serve(app)`.
- **No machinery.** Behave correctly instead of building hooks, guards, or generators to enforce behavior.
- **Behavior kept.** A refactor keeps behavior at every usage point. Two differences are accepted and reported with the change: one no usage point observes that makes the code simpler, and one a rule here causes, such as an error keeping its cause or sorted keys, unless a usage point parses it; printed diagnostics are not a contract. Any other behavior change is the user's decision, except a reachable bug's fix.
- **Reachable bugs.** A bug a real input from a usage point triggers is fixed and reported, with every consumer of the changed output checked. Handling for input no caller produces is deleted; anything that looks intentional or that other code relies on is kept and reported as possibly intentional.
- **Performance.** Improve performance in the touched code where you know how; measure on a realistic input only when a change claims speed or keeps a slower-looking form.
- **Type safety.** A fix never weakens types to make a symptom go away: no widened or erased type, cast, dropped generic, or loosened exported type.
- **Domain.** Implement the definition the domain uses, such as a cycle for recursion, never the nearest syntactic proxy.
- **Reread.** Before finishing, reread the diff and delete every line the outcome does not require.

**Happy path.** Failures flow through the error channel: no catch, retry, fallback, backup, or defensive check unless the request or an existing contract needs it.

```ts
// good — a missing file fails on its own
const write = Effect.fn('Config.write')(function* (rendered: string) {
	yield* fs.writeFileString(configPath, rendered)
})
// bad — "adding all those checks add complexity and i feel like it's not necessary"
fs.exists(manifestPath) // a check the write already makes
readReceipt('dual.openapi.json') // regeneration tracking nobody asked for
fs.copyFile(configPath, `${configPath}.backup`) // "never backup previous configs"
```

**Trusted data.** Validate and transform once, at the boundary, with Effect Schema; inside, carry narrowed values forward and never re-check what the schema, the declared type, an earlier filter, or every caller guarantees.

```ts
// good
const add = Effect.fn('Ledger.add')(function* (draft: LedgerDraft) {
	yield* Ref.update(entries, Array.append(draft))
})
// bad — "data inside the program matches its type"
Schema.decodeEffect(LedgerDraft)(draft) // draft is already a LedgerDraft
variable.init?.type === 'TSSatisfiesExpression' // init was already narrowed to non-null
```

**Effect first.** Before hand-writing a traversal, accumulator, check, config read, or service, search the installed Effect source (Graph, Record, String, Option, Struct, Config.all, Match, Boolean, HttpClient, Path, ChildProcess) and call what exists; replace every third-party dependency Effect or a Node built-in through Effect's platform packages covers.

```ts
// good
const cycles = Graph.stronglyConnectedComponents(graph)
BigDecimal.format(amount)
Duration.parts(DateTime.distance(oldest.timestamp, newest.timestamp)).days
fs.glob('**/.env*.example', {exclude: ['**/node_modules'], root: config.cwd})
// bad — "overcomplicated for no reason just to satisfy immaginary requirement that never existed"
const digits = BigDecimal.scale(BigDecimal.abs(amount), 2).value.toString().padStart(3, '0')
Math.floor(Duration.toDays(DateTime.distance(oldest.timestamp, newest.timestamp)))
import {glob} from 'glob' // a dependency Effect's FileSystem replaces
```

**Whole values.** Pass a value whole or spread it; never destructure a parameter, callback argument, or loop variable (`useState` and a component's `ref` prop excepted) or re-list its fields, unless the target must not see the rest.

```ts
// good
server => ({server: {...server, forwardConsole: true, warmup}})
for (const schema of schemas) report(schema.name)
Record.map(groups, entries => entries.length)
upload({scope: input.scope, type: input.type}) // input also holds the bearer token
// bad — "you deconstructed the args witch is something that i hate"
({host, port}) => ({server: {forwardConsole: true, host, port, warmup}})
server: {forwardConsole: true, host: config.host, port: config.port, warmup}
for (const {name} of schemas) report(name)
Array.map(Record.toEntries(groups), ([key, entries]) => entries.length)
```

**Nearest sibling.** Extend the nearest existing implementation of the same kind, mirroring its permissions, errors, data refresh, and tests; reuse the feature's helper before writing one; change only the state an action changes.

```tsx
// good — the sibling's permission gate, its helper, and only the runs refreshed
<PermissionGate permission="deploy_version.run"><Button onClick={openRunDialog}>Run</Button></PermissionGate>
WorkflowRunError.failureMessage(error)
queryClient.invalidateQueries({queryKey: organizationWorkflowRunKeys.all})
// bad — a deploy Run button beside the Tests page's
<Button onClick={openRunDialog}>Run</Button> // the sibling sits behind the run permission
const runFailureMessage = (error: RunError) => error.descriptions.join('\n') // a copy of WorkflowRunError.failureMessage
queryClient.invalidateQueries({queryKey: workflowDeployKeys.detail(deployId)}) // a run changes runs, not the deploy
```

**Once.** Logic that appears twice, such as an error mapping, header normalization, or SDK call wrapping, becomes one function or value; one fact lives in one place.

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

**Canonical data.** Send and store canonical data only and derive the rest where it is used; surface each state once, where the user acts on it; keep only states something produces.

```tsx
// good
optionForModel(value, models.models)
defaultModel: AiModelReference
// bad — "the code is still over-complicated": a chat model picker
export const modelKey = (model: AiModel) => `${model.providerId}:${model.modelId}` // a copy of optionForModel
defaultModel: Schema.Struct({providerId, providerName, modelId, name, available}) // the client derives four of them
type PickerState = {status: 'ready'} | {status: 'unsupported'} // a prototype's variant that nothing produces anymore
```

**One way.** A change replaces what it supersedes: no field, method, option, export, or code path duplicates another or is a subset or superset of it.

```ts
// good — no branch is the detached state; the SubscriptionRef gives the current value and the changes
export type GitStatus = typeof GitStatus.Type
export const GitStatus = Schema.Struct({branch: Schema.optionalKey(Schema.NonEmptyString)})
readonly status: SubscriptionRef.SubscriptionRef<GitStatus>
// bad — "i don't want to have multiple ways to do the same thing"
export const GitStatus = Schema.Struct({branch: Schema.optionalKey(Schema.String), detached: Schema.Boolean})
current: Effect.Effect<GitStatus>
changes: Stream.Stream<GitStatus> // two ways to read one state
```

**No compatibility.** Change a name or shape and update every caller in the same change, with no alias, fallback, deprecated path, or flag; only a contract the repository documents or the user names survives, such as production data from the previous release.

```ts
// good
const name = input.name
// bad — "don't consider backward and forward compatibility since they don't matter"
const name = input.displayName ?? input.name // the old field kept readable
```

**Present needs.** No option, parameter, layer, abstraction, export, file, script, or check for a need that does not exist yet; a config holds only what the caller varies.

```ts
// good
export type Config = {main: AiAgentDefinition; model: AiModel; toolkit: Toolkit.Toolkit<Ai.Tools>}
// bad — "things like the pollInterval shouldn't be configurable"
export type Config = {pollInterval: Duration.Duration; remote: GitRemote; token: Secret.Secret}
```

**Dead code.** Every superseded or unused file, export, type, branch, config, validation, doc, test, and dependency goes in the same change.

```text
// good — one walker, the CLI's --help as its documentation
src/generator/resolve.ts
// bad — "code from previous iterations that isn't used or necessary anymore"
src/generator/resolve.ts, src/generator/referenceProblem.ts   // two $ref walkers after a rewrite
README.md, AGENTS.md, SKILL.md, sdk guide, changeset          // the same CLI flags five times
HANDOFF-openapi-plugin.md, stray worktrees                    // artifacts left after "done"
```

## Lint pairs

The forms below are the ones lint enforces without an autofix, and the single form that satisfies every rule involved.

**Fallback.** A default is `??`; never a ternary on the same value.

```ts
// good
const root = options?.root ?? '.'
// bad — no-negated-condition flips it, then prefer-nullish-coalescing flags it
const root = options?.root !== undefined ? options.root : '.'
```

**Conditions.** A boolean is tested bare; `=== true` only on a value that may be undefined.

```tsx
// good
if (enabled) return
aria-current={props.selected === true ? 'page' : undefined}
// bad
if (enabled === true) return // enabled is a boolean
if (props.selected) return // props.selected may be undefined
```

**Flat.** Plain `if`, `for`, and `yield*` statements in `Effect.fn` with early returns, never nested ternaries or a `Boolean.match`, `Option.match`, or `pipe` that nests deeper than statements would; the combinator is for a single expression, and a value chosen by a boolean is a `Boolean.match` (a one-line ternary stays only in a JSX attribute).

```ts
// good
const kill = Effect.fn('Sandbox.kill')(function* (sandbox?: Sandbox) {
	if (sandbox?.status !== 'running') return

	yield* sandbox.kill
})
Boolean.match(ignoreCase, {onFalse: () => undefined, onTrue: () => 'i'})
// bad — "i hate unnecessary deep nesting, i like flat pipelines"
const type = event.type === 'text-delta' ? 'text' : event.type === 'reasoning-delta' ? 'reasoning' : 'unknown'
const flags = ignoreCase ? 'i' : undefined // "instead of a ternary the Boolean.match would be cleaner"
// bad — "use an Effect.fn and don't use pipe, then unnest"
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

**Options.** Read an Option through `Option.match`, `Option.map`, or `Option.getOrElse`, never `.value`; Option only where a pipeline composes it, otherwise `?:` and `undefined` stay plain.

```ts
// good
Option.map(Number.parse(event.target.value), field.handleChange)
Option.map(Array.head(parts), part => part.text)
// bad — "Option sporadically, when it makes the code cleaner"
if (Option.isSome(open)) open.value.append(event.delta)
const parsed = Option.getOrUndefined(Number.parse(event.target.value))
```

**Handlers.** A handler used once is an arrow in place; a handler used twice is a `function`.

```tsx
// good
function Toolbar() {
	return <Button onClick={() => setOpen(true)}>Open</Button>
}
function openDialog() {
	setOpen(true)
}
// bad — func-style and no-trivial-indirection
const openDialog = () => setOpen(true)
```

**Pairs.** A tuple stays whole, read by index.

```ts
// good
Array.filter(Record.toEntries(counts), entry => entry[1] > 0)
// bad
Array.filter(Record.toEntries(counts), ([name, count]) => count > 0)
```

**Accumulators.** No `let`: a fold or an Effect collection operation that says what it selects.

```ts
// good
const total = Array.reduce(values, 0, Number.sum)
pipe(teamId, String.split(','), Array.map(String.trim), Array.findFirst(String.isNonEmpty))
Array.filterMap(items, item => (supports(item) ? Result.succeed(item.value) : Result.failVoid))
// bad — "as functional and immutable as possible"
let total = 0
for (const value of values) total += value
const [first] = teamId
	.split(',')
	.map(value => value.trim())
	.filter(value => value.length > 0)
items.filter(item => supports(item)).map(item => item.value)
```

**Natives.** Effect's modules over globals and native methods (`Array`, `String`, `Number`, `Record`, `Predicate`, `Clock`, `Random`, `Config`, `FileSystem`); a third-party API's own method stays, with an inline disable and its reason.

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

```ts
// good
const toolkit = pipe(PiToolkit, Effect.provide(handlerContext))
// bad
const toolkit = PiToolkit.pipe(Effect.provide(handlerContext))
```

**Failures.** In a generator a failure is `return yield* E.make(...)`; outside one, `Effect.fail`.

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

**Casts.** No `as`, `any`, or `unknown` annotation: decode unknown data once with a schema at the boundary; `satisfies` and `as const` are the only assertions.

```ts
// good
const params = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(part.params)
return Effect.succeed([{text: part.text, type: 'text'} satisfies TextContent])
// bad — a cast satisfies one rule and the next flags it
const params = part.params as Record<string, unknown>
create: Effect.fnUntraced(function* (input: unknown) {
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

**Imports.** A module under its own name, except the aliases shadcn generates in the ui package; types in their own `import type` line; packages first, a blank line, then the `#` aliases. Every export has an importer.

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

**Readonly.** Every property of a service shape is readonly, as in Effect's services, and so may class members be; readonly appears nowhere else, except on a `Schema.suspend` cycle's hand-written types.

```ts
// good
type Holder = {error: ToolExecutionError; time: DateTime.Utc; value: string[]}
// bad
type Holder = {readonly error: ToolExecutionError; readonly value: ReadonlyArray<string>}
```

**Disables.** When a rule seems to force worse code, write the Effect-correct form or report the rule defect with a minimal repro, never the worse form silently. An inline disable only where the code has no other correct form, with its reason after `--`, never a per-file list in config, and never for an order rule such as sort-keys, which always has a correct form. A diagnostic no edit to the file clears, such as a duplicate package from the lockfile, is reported, not chased; a file name `unicorn/filename-case` flags is renamed.

```ts
// good
// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack Router augments this interface by name.
// @effect-diagnostics-next-line nodeBuiltinImport:off -- Vite's plugin API hands over a Node server.
// bad — "why are we adding the exactOptionalPropertyTypes instead of fixing the code?"
"exactOptionalPropertyTypes": false
// oxlint-disable-next-line typescript/consistent-type-assertions
// oxlint-disable-next-line sort-keys -- keeps the printed order
// bad — "why are we not disabling the cases with the ignore comments?"
files: ['packages/components/src/components/agent-browser.tsx', 'packages/components/src/components/form.tsx'],
// bad — "keep it enabled so other cases get fixed"
ignorePatterns: ['src/generated/**'] // generated code escapes lint
```

## Effect

**Functions.** `Effect.fn('Name.method')` at a traced boundary when there are arguments, `Effect.fnUntraced` for an internal helper, `Effect.gen` for two or more statements without arguments, and the effect itself for one; `Effect.fn.Return` when the return is annotated.

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
// bad — "if there is an arg you must use the Effect.fn"
fetch: url => Effect.tryPromise(() => fetch(url))
const decodePart = Effect.fn('decodePart')(function* (part: Part) {}) // a span on an internal helper
const stop = Effect.gen(function* () {
	yield* setStatus('stopping')
}) // one statement
```

**Errors.** One domain error per service, the only error its signatures name, with the cause kept; mapped in the pipeline argument of `Effect.fn`, nothing caught. An SDK failing with unknown is mapped at the adapter, and a cause that may hold secrets stays redacted. "fail fast instead of retrying".

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
// bad — "malformed output fails instead of becoming empty data"
pipe(
	fs.readFileString(target),
	Effect.catch(() => Effect.succeed(''))
)
pipe(loadConfig, Effect.retry(Schedule.recurs(3)))
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped, new
Effect.catch(error => pipe(cleanup, Effect.andThen(Effect.fail(error)))) // fails again with the error it caught
load: (path: string) => Effect.Effect<void, PlatformError | Schema.SchemaError> // library failures leak from the service
```

**Services.** A service with one implementation builds it inline in its layer; several backends get one named layer each, like `Ai.layerPi`; a service with a default value is a `Context.Reference`; an implementation is the service's `of` or a plain object that satisfies its shape, and its methods are readonly properties.

```ts
// good
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('@deslop/ledger/service/Ledger') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const entries = yield* Ref.make(Array.empty<LedgerEntry>())
			return Ledger.of({add: add(entries), balanceByTag: balanceByTag(entries)})
		})
	)
}
export class Ai extends Context.Service<Ai, Ai.Agent>()('@deslop/ai/service/Ai') {
	static layerPi(config: Pi.Config) {
		return Layer.effect(this, makePi(config))
	}
}
export const Verbose = Context.Reference<boolean>('@deslop/ai/Verbose', {defaultValue: () => false})
// bad — "in most cases i don't have a default implementation"
class Logger extends Context.Service<Logger>()('Logger', {make: Effect.succeed(service)}) {}
static readonly layer = Layer.effect(Ledger, makeLedger) // a make with one caller
query(sql: string): Effect.Effect<Rows> // a method signature instead of a readonly property
```

**Primitives.** Use Effect's primitives directly; rpcs and services already trace, and one scope owns each lifetime.

```ts
// good
const connect = Effect.gen(function* () {
	const state = yield* SubscriptionRef.make(PortfolioState.make({}))
	const socket = yield* Effect.acquireRelease(openSocket, closeSocket)
	return {socket, state}
})
// bad — "not wrappers over the effect primitives, utils that compose with them"
class State {
	update(f: (s: PortfolioState) => PortfolioState) {
		return SubscriptionRef.update(this.ref, f)
	}
}
const traced = Effect.withSpan('Notes.create')(notes.create(input))
Effect.addFinalizer(() => closeSocket(socket)) // acquisition and release with different owners
```

**Runtime.** The owned runtime runs the program; a Promise an external contract demands is bridged once, where it is returned.

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

**Inference.** Types are inferred; only a recursive function, or a callback whose branches TypeScript cannot unite, is annotated; a signature names the schema pair or an indexed part of it.

```ts
// good
const balances = Array.reduce(decoded, HashMap.empty<Tag, BigDecimal.BigDecimal>(), sumByTag)
function visit(node: Node): Result {
	return visit(node.parent)
}
function settle(amount: LedgerEntry['amount']) {
	return BigDecimal.format(amount)
}
export type Sandbox = ReturnType<typeof fromSdk>
// bad — "are you sure this doesn't infer everything?"
const Input = Schema.Struct({value: Schema.String}) satisfies Schema.Schema<Input>
export type SandboxLike = {id: string; renew: (seconds: number) => Promise<unknown>} // a copy of an inferred shape
```

**Schema pairs.** Every schema, exported or not, has its type pair on the line before; a struct is a `Schema.Struct`, never a `Schema.Class`; a derived schema spreads the fields it reuses; the schema's `make` is called directly and owns validation and defaults.

```ts
// good
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
RunEventCursor.make(value.toString())
trails: pipe(Schema.Array(PortfolioTrail), Schema.withConstructorDefault(Effect.succeed([])))
// bad — "the type ... same name ... the line before"
export type EntryDraft = {amount: EntryAmount; id?: EntryId; tag: string} // a hand-written shape beside the schema
// bad — "the schema .make method directly without wrapping it"
new AiError({message: 'The model returned no text'}) // the schema has make
function cursorFromBigInt(value: bigint) {
	return RunEventCursor.make(value.toString())
}
payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'name', 'x', 'y']))) // the schema itself fits
```

**Cycles.** Every name on a recursive cycle is a hand-written type and only the `Schema.suspend` thunk is annotated; names off the cycle stay inferred, and the union follows its members.

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
// bad — "why are you not putting this as a static method of the error schema?"
function isPathNotFound(error: unknown) {
	return Schema.is(FileNotFound)(error)
}
```

## Shape

**Inline.** Inline every forwarding wrapper, single-use helper, temporary, and top-level const into its one use; a function that reads no argument is a value, named once.

```ts
// good
function randomIndex(length: number) {
	return Random.Random.defaultValue().nextIntUnsafe() % length
}
const isApiUrl = Predicate.compose(String.isString, Predicate.or(Equal.equals('/api'), String.startsWith('/api/'))) // a predicate, reused
static generateText = generateTextPi
const notFound = HttpServerResponse.empty({status: 404})
// bad — "why is this extracted here? can't we just inline it?"
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

**File tree.** Anyone scanning the tree finds everything at first glance: role folders whose files follow one naming scheme, the way a file-based router does, explicit kebab-case names, one bigger file over several nearly empty ones, tests beside their subject as `<name>.test.ts`, and no barrel.

```text
// good
src/rpcs/contracts.ts, src/rpcs/handlers.ts, src/routes/(home)/index.tsx
src/rules/no-typeof.ts, src/rules/no-constant-function.ts, src/rules/rules.test.ts
// bad — a barrel, near-empty files, and names that say nothing
src/index.ts, src/types.ts (one alias), src/constants.ts (one value), src/helpers/misc.ts
```

**Package surface.** `package.json` `exports` names each subpath a consumer imports, and the package reaches its own files through explicit `imports` aliases; a package's lint config is the shared preset alone, and generated code is linted like hand-written code.

```ts
// good
"exports": {"./plugin": "./src/generated/plugin.ts"}
export {oxlint as default} from '@deslop/workflow'
// bad — consumers import two names from a barrel of everything
export * from './generated/Client.ts'
const warned = ['sort-keys', 'typescript/no-restricted-types'] // a package rule list
"typecheck": "tsc --noEmit" // type-aware lint already checks types
```

## React

**Components.** React Compiler memoizes; state is destructured at its declaration; refs are props; logic lives in atoms.

```tsx
// good
const editorRef = useRef<Lexical.LexicalEditor>(null)
const [showShortcuts, setShowShortcuts] = useState(false)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
// bad
const handle = useCallback(() => setOpen(true), [])
const state = useState(false)
```

## Tests

A few tests, each guarding logic worth guarding, beat coverage: every test is code to read and maintain.

- **Worth it.** Test logic the repository owns, its branching, computation, parsing, and state transitions, where a plausible regression breaks it and nothing else would catch it; touched logic worth a test that none covers gets a case, added before a refactor rewrites it.
- **Seam.** Test the exported layer, service, or function of a package or an app's service as a black box, so rewriting the implementation leaves every test green; the browser proves UI components.
- **Guaranteed elsewhere.** Leave untested types tsc checks, rules a schema declares, the Effect runtime, a dependency, the platform, another tool's output, wiring that only shows a call reaching a double, constants and pinned counts, wording, removed behavior, input no caller produces, and a second input for covered behavior; delete such cases in every test file the change edits.
- **Independent.** Expected values come from the brief or a worked example, never a recomputation of what the code does; fixtures are the inputs the request names, or the smallest reachable input that makes the logic decide.
- **Bugs.** Reproduce a bug before fixing it; its failing case stays only when the fixed logic meets this bar, in the existing test that covers the fixed code.
- **Throwaway.** Settle a worry with a throwaway test or prototype and delete it once answered.
- **Honest.** A test never expects wrong behavior or works around another rule; an expectation changes only with a recorded behavior change, and a changed assertion keeps every value the old one checked that still meets this bar.

**Assertions.** One input per behavior in the existing case that covers it; a test helper grows only when every case needs it; assert which input is flagged or returned, or an error's tag, code, or path, with `assert` from `@effect/vitest`; doubles are Layers or a dependency the public function takes, never vi, a global stub, or a module mock; one layer per file.

```ts
// good — "test files only for the services/packages public interfaces"
it.layer(Layer.provideMerge(Ledger.layer, NodeServices.layer))(test => {
	test.effect('keeps the previous entries when the file is malformed', () => run(program))
})
assert.deepStrictEqual(customCodes(result.stdout), ['@deslop/workflow(no-typeof)'])
assert.containsSubset(error, {_tag: 'SandboxUnavailable', cause: killed})
Layer.succeed(OpenSandbox, openSandbox)
// bad — "1 userful test is better than 1000 useless ones"
it.effect('rejects an empty tag', () => run(ledger.add({tag: ''}))) // Schema.isNonEmpty already does
// bad — "this test is useless, it doesn't test that the agent is working"
it.effect('forwards the prompt', () => run(agent.prompt(message))) // wiring that only shows a call reaching a double
additional?: {name: string; source: string}[] // a helper option one case needs
it.effect('loads', () => pipe(program, Effect.provide(Ledger.layer))) // the layer, per test
assert.isTrue(Array.some(diagnostics, d => d.code === 'typescript(TS2456)')) // another tool's output
expect(error).toMatchObject({_tag: 'SandboxUnavailable'}) // Vitest's expect
assert.strictEqual(Array.flatMap(attioProvider.groups, group => group.actions).length, 75) // a pinned count
```
