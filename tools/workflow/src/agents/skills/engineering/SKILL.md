---
name: engineering
description: 'Engineering rules for product code. Use before designing or editing code, writing tests, or reviewing a diff.'
---

Apply the repository's CODING_STANDARDS.md alongside these rules; where the two conflict or leave a case ambiguous, this skill wins, and both take precedence over a repository's other coding standards. Lint is a fallback that applies autofixes: write every rule below correctly the first time, whether or not a linter checks it. The deslop codebase is the minimum bar for structure and consistency in every repository.

## Simplicity

Everything you produce — code, names, files, folders, tests, and the diff a reviewer reads — is understood at first glance, without having to think: simple and idiomatic, never clever, with no abstraction the reader has to unwrap. Every line not needed now slows the next change. Build the smallest thing that does the requested job well:

- Write the plain, explicit, idiomatic solution, readable top to bottom: no comments and no clever tricks; inline every forwarding wrapper and every single-use helper or top-level const, as Shape shows.
- Keep code flat: pipelines and early returns instead of nesting, a blank line between logical groups. Flatness outranks idiom: where `Boolean.match`, `Option.match`, `Option.toArray`, or a `pipe` would nest deeper than plain `if`, `for`, and `yield*` statements in `Effect.fn`, write the statements; the idiom is for a single expression.
- Do only what is asked, and never add anything unrequested. A refactor or cleanup request asks for depth instead: every section applies to every line of the owned files, not only the changed lines.
- Extend the nearest existing implementation of the same kind, mirroring its permissions, errors, data refresh, and tests, and reuse the feature's helper for a job before writing one.
- Happy path only: let failures flow through Effect's error channel, with no catch, retry, fallback, or defensive check unless the request or an existing contract requires it.
- Validate and transform once, at the boundary, with Effect Schema; inside, data is trusted: carry narrowed values forward and never re-check what the schema, the declared type, an earlier filter, tsc, or every caller's context guarantees.
- Layers depend inward: domain and service code never import HTTP, RPC, or other transport types.
- Offer building blocks the caller composes like any Effect module — services, Layers, and functions provided and combined in the open — never a wrapper that bundles them behind one call such as `serve(app)`.
- Before hand-writing a traversal, accumulator, check, or config read, search the Effect repository at `~/.deslop/repos/effect` (Graph, Record, String, Option, Struct, Config.all, Match, Boolean, HttpClient, Path, ChildProcess, Types.Equals) and call the helper that exists. Before adding any service, run `rg --files ~/.deslop/repos/effect/packages/*/src` for its name, and when Effect ships it, use it or push back with its path. Clone a missing library source into `~/.deslop/repos`.
- Never destructure a parameter, callback argument, or loop variable (`useState` and a component's `ref` prop excepted), and never re-list a value's fields: pass it whole or spread it, unless the target must not see the rest.
- No future-proofing: no option, parameter, layer, abstraction, export, file, script, or check for a need that does not exist yet.
- Someone scanning the file tree finds everything at first glance: files and folders are simple, well structured, and consistent, with role folders whose files follow one naming scheme, the way a file-based router does, and explicit kebab-case names that say what each file holds. A file exists only for a distinct role: prefer one bigger file to several nearly empty ones, and put anything that can live in an existing file there; no barrel file, and no file that adds no value.
- A package exposes explicit `package.json` `exports` subpaths and imports its own files through explicit `imports` aliases, which work in Node and Bun and keep dead code traceable. Tests sit beside their subject as `<name>.test.ts`.
- One way to do each thing: a change replaces what it supersedes instead of layering beside it, so no field, method, option, export, or code path duplicates another or is a subset or superset of it.
- No compatibility, backward or forward: change a name or shape and update every caller in the same change, with no alias, fallback, deprecated path, or flag. Only a contract the repository documents or the user names survives, such as production data from the previous release.
- Delete dead code: every superseded or unused file, export, type, doc, test, and dependency goes in the same change; keep the type half of a schema pair and leave no leftover.
- Replace every third-party dependency you can with an Effect module, or with a Node built-in reached through Effect's platform packages.
- Change only the state an action changes: refresh, invalidate, or rerender nothing else.
- Send and store canonical data only; derive the rest where it is used, and surface each state once, where the user acts on it.
- Touch only what the request needs; an unrelated improvement is a proposal for the user.
- Behave correctly instead of building machinery, such as hooks, guards, or generators, to enforce behavior.
- A refactor or mechanical pass keeps behavior at every usage point. Two differences are accepted and reported with the change: one no usage point observes that makes the code simpler, and one a rule here causes, such as an error keeping its cause, sorted keys, or Effect-native formatting, unless a usage point parses it; printed diagnostics are not a contract. Any other behavior change is the user's decision, except a reachable bug's fix.
- A reachable bug, one a real input from a usage point triggers, is fixed and reported, with every consumer of the changed output checked. Handling for input no caller produces is deleted instead; anything that looks intentional or that other code relies on is kept and reported as possibly intentional.
- Improve performance in the touched code where you know how; measure beyond noise on a realistic input only when a change claims speed or keeps a slower-looking form.
- A fix never weakens type safety to make a symptom go away, a performance or type-check-speed change included: no widened or erased type, cast, dropped generic, or loosened exported type.
- Implement the definition the domain uses, such as a cycle for recursion, never the nearest syntactic proxy.
- Before finishing, reread the diff and delete every line the outcome does not require.

```ts
// good — Effect's helpers, values taken whole, data trusted after the boundary
const graph = Graph.directed<string, undefined>(mutable => {
	for (const schema of schemas) Graph.addNode(mutable, schema.name)
	for (const edge of edges) Graph.addEdge(mutable, edge.from, edge.to, undefined)
})
const cycles = Graph.stronglyConnectedComponents(graph)
String.isNonEmpty(event.delta)
pipe(Option.fromNullishOr(schema.id.typeAnnotation), Option.exists(annotation => schemaSchemaType({context, node: annotation.typeAnnotation})))
server => ({server: {...server, forwardConsole: true, warmup}})
server: {...config, forwardConsole: true, warmup}
Array.isReadonlyArrayEmpty(node.arguments)
payload: PortfolioVisitor
recursive: boolean

// bad — "you deconstructed the args witch is something that i hate"
function reachesStart(name: string, seen: string[], suspended: boolean): boolean {
event.delta !== ''
annotation !== null && annotation !== undefined && schemaSchemaType({context, node: annotation})
({host, port}) => ({server: {forwardConsole: true, host, port, warmup}})
server: {forwardConsole: true, host: config.host, port: config.port, warmup}
node.arguments.length === 0
for (const {name, statement, variable} of schemas) report(name)
variable.init?.type === 'TSSatisfiesExpression' // init was already narrowed to non-null
payload: Schema.Struct(pipe(PortfolioVisitor.fields, Struct.pick(['color', 'id', 'name', 'x', 'y'])))
recursiveTypes: ReturnType<typeof recursiveTypeAliases> // a tracker where a value is enough
```

```ts
// good — the requested behavior; a missing file fails on its own
yield * fs.writeFileString(configPath, rendered)
// bad — "adding all those checks add complexity and i feel like it's not necessary"
if (!(yield * fs.exists(manifestPath))) return yield * new UninstalledAssetError({path: manifestPath})
const previous = yield * readReceipt('dual.openapi.json') // regeneration tracking nobody asked for
yield * fs.copyFile(configPath, `${configPath}.backup`) // "never backup previous configs"
```

```ts
// good — Effect's glob covers every usage point; the dropped dot-folder match is reported with the change
yield * fs.glob('**/.env*.example', {exclude: ['**/node_modules'], root: config.cwd})
// bad — "overcomplicated for no reason just to satisfy immaginary requirement that never existed"
import {glob} from 'glob' // a dependency Effect's FileSystem replaces
yield * Effect.tryPromise(() => glob(pattern, {dot: true, ignore})) // no usage point has a dot folder
```

```tsx
// good — the sibling's shape: its permission gate, its helper reused, only the changed state refreshed
<PermissionGate permission="deploy_version.run"><Button onClick={openRunDialog}>Run</Button></PermissionGate>
WorkflowRunError.failureMessage(error)
queryClient.invalidateQueries({queryKey: organizationWorkflowRunKeys.all})
// bad — a deploy Run button beside the Tests page's
<Button onClick={openRunDialog}>Run</Button> // the sibling Run button sits behind the run permission
const runFailureMessage = (error: RunError) => error.descriptions.join('\n') // a copy of WorkflowRunError.failureMessage
queryClient.invalidateQueries({queryKey: workflowDeployKeys.detail(deployId)}) // a run changes runs, not the deploy
```

```tsx
// good — the existing helper, canonical data, only reachable states
optionForModel(value, models.models)
defaultModel: AiModelReference
usage: Option.Option<ComposerUsage>
// bad — "the code is still over-complicated": a chat model picker
export const modelKey = (model: AiModel) => `${model.providerId}:${model.modelId}` // a copy of optionForModel
defaultModel: Schema.Struct({providerId, providerName, modelId, name, available}) // the client derives four of them
| {readonly status: 'unsupported'} // a prototype's variant that nothing produces anymore
const letterColor = hashHue(provider) // a fallback logo for providers nobody has
```

```ts
// good — package.json exposes only what a consumer imports, as a subpath
"exports": {"./plugin": "./src/generated/plugin.ts"}
// bad — a barrel re-exports every schema, action, and client internal; consumers import two names
export * from './generated/Client.ts'
export * from './generated/Plugin.ts'
```

```ts
// good — one way: no branch is the detached state; the SubscriptionRef gives the current value and the changes
export type GitStatus = typeof GitStatus.Type
export const GitStatus = Schema.Struct({branch: Schema.optionalKey(Schema.NonEmptyString)})
readonly status: SubscriptionRef.SubscriptionRef<GitStatus>
// bad — "i don't want to have multiple ways to do the same thing"
export const GitStatus = Schema.Struct({branch: Schema.optionalKey(Schema.String), detached: Schema.Boolean}) // detached is a missing branch
readonly current: Effect.Effect<GitStatus>
readonly changes: Stream.Stream<GitStatus> // two ways to read one state
// bad — "don't consider backward and forward compatibility since they don't matter"
const name = input.displayName ?? input.name // the old field kept readable
```

```text
// good — one walker, the CLI's --help as its documentation, and nothing left behind
src/generator/resolve.ts
// bad — "code from previous iterations that isn't used or necessary anymore"
src/generator/resolve.ts, src/generator/referenceProblem.ts   // two $ref walkers after a rewrite
README.md, AGENTS.md, SKILL.md, sdk guide, changeset          // the same CLI flags five times
HANDOFF-openapi-plugin.md, ~/.ab/, stray worktrees            // artifacts left after "done"
```

## Types

```ts
// good — inferred; only a recursive function, or a callback whose branches TypeScript cannot unite, is annotated; satisfies and as const are the only assertions
const decoded = yield* Schema.decodeEffect(LedgerFile)(yield* fs.readFileString(path))
const balances = Array.reduce(decoded, HashMap.empty<Tag, BigDecimal.BigDecimal>(), sumByTag)
function visit(node: Node): Result {
	return visit(node.parent)
}
Array.flatMap(message.content, (part): (TextContent | ThinkingContent)[] => {
return Effect.succeed([{text: part.text, type: 'text'} satisfies TextContent])
export type Sandbox = ReturnType<typeof fromSdk>
// bad — "are you sure this doesn't infer everything?"
fn: RpcClient.runtime.fn<{onSuccess: (message: string) => void}>()(
const Input = Schema.Struct({value: Schema.String}) satisfies Schema.Schema<Input>
export type SandboxLike = {id: string; renew: (seconds: number) => Promise<unknown>} // a copy of an inferred shape
```

```ts
// good — unknown is a fallback inference leaves where a provider payload enters, never written as an annotation; a method takes the schema's Type as is
const params = Schema.decodeUnknownOption(Schema.Record(Schema.String, Schema.Unknown))(part.params)
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage) {
// bad — "data inside the program matches its type"
create: Effect.fnUntraced(function* (input: unknown) {
	const note = yield* Schema.decodeUnknownEffect(CreateNote)(input)
const add = Effect.fn('Ledger.add')(function* (draft: LedgerDraft) {
	const decoded = yield* Schema.decodeEffect(LedgerDraft)(draft) // draft is already LedgerDraft
```

## Schema

```ts
// good — every schema, exported or not, has its type pair on the line before; a struct is a Schema.Struct, never a Schema.Class; a derived schema spreads the fields it reuses; a signature names the pair or an indexed part of it
export type AiAgent = typeof AiAgent.Type
export const AiAgent = Schema.Literals(['pi'])
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
function settle(amount: LedgerEntry['amount']) {
// bad — "the type ... same name ... the line before"
export type EntryDraft = {amount: EntryAmount; id?: EntryId; tag: string} // a hand-written shape beside the schema
```

```ts
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
// good — the schema pair at module scope, decoded at the call site
type PackageManifest = typeof PackageManifest.Type
const PackageManifest = Schema.fromJsonString(
	Schema.Struct({dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String))})
)
const manifest = yield * Schema.decodeEffect(PackageManifest)(yield * fs.readFileString(path))
```

```ts
// good — the schema's make, called directly; the schema owns validation and defaults
return Effect.fail(AiError.make({message: `Pi does not support ${part.mediaType} prompt parts`}))
RunEventCursor.make(value.toString())
// bad — "the schema .make method directly without wrapping it"
new AiError({message: 'The model returned no text'}) // the schema has make
function cursorFromBigInt(value: bigint) {
	return RunEventCursor.make(value.toString())
}
if (value < 0n) throw new Error('negative') // validation the schema owns
```

```ts
// good — a predicate is a static member of its tagged error; a struct's schema is checked inline
class PathNotFound extends Schema.TaggedError<PathNotFound>()('PathNotFound', {cause: Schema.optional(Schema.Defect())}) {
	static matches = (error: Cause.UnknownError) => Schema.is(FileNotFound)(error.cause)
}
Schema.is(LedgerEntry)(value)
// bad — "why are you not putting this as a static method of the error schema?"
function isPathNotFound(error: unknown) {
```

## Effect

```ts
// good — Schema, Array, String, Number, Predicate over globals
Number.parse(input.count)
Array.map(commits, commit => commit.subject)
Predicate.isString(value)
// bad — a global where Number has the helper
const count = parseInt(input.count)
```

```ts
// good — a one-line ternary stays, Boolean.match for a boolean, Match for a union
aria-current={props.selected === true ? 'page' : undefined}
Boolean.match(ignoreCase === true, {onFalse: () => undefined, onTrue: () => 'i'})
pipe(Match.value(props.layer), Match.when('claude', () => <ClaudeDark />), Match.when('codex', () => <CodexDark />), Match.exhaustive)
// bad — "instead of a ternary the Boolean.match would be cleaner"
const type = event.type === 'text-delta'
	? 'text'
	: event.type === 'reasoning-delta' ? 'reasoning' : 'unknown'
// bad — "use an Effect.fn and don't use pipe, then unnest"; the old if blocks were flat
const parts = Array.appendAll(base, Boolean.match(hasTools, {onFalse: () => [], onTrue: () => pipe(tools, Array.map(tool => pipe(tool, Option.toArray)))}))
```

```ts
// good — Match instead of switch; an Option read through its combinators; Predicate for a nullish check
pipe(
	Match.value(usage.kind),
	Match.when('input', () => 'in'),
	Match.when('output', () => 'out'),
	Match.exhaustive
)
pipe(
	open,
	Option.filter(section => section.id === event.id),
	Option.match({onNone: () => start(event), onSome: section => section.append(event.delta)})
)
Predicate.isNotNullish(annotation)
// bad
switch (usage.kind) {
	case 'input':
		return 'in'
	case 'output':
		return 'out'
}
if (Option.isSome(open) && open.value.id === event.id) open.value.append(event.delta)
annotation !== null && annotation !== undefined
```

```ts
// good — fnUntraced for an internal helper, fn('Name.method') at a traced boundary, Effect.fn.Return when the return is annotated; Result for a fallible pure value; a service with a default value is a Context.Reference; Order for sorting
const decodePart = Effect.fnUntraced(function* (part: Part) {
	return yield* Schema.decodeEffect(Event)(part)
})
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage): Effect.fn.Return<void, AiError> {
	yield* send(message)
})
Result.fromOption(Array.head(parts), () => AiError.make({message: 'The model returned no parts'}))
export const Verbose = Context.Reference<boolean>('@deslop/ai/Verbose', {defaultValue: () => false})
Array.sort(
	entries,
	Order.mapInput(Order.Number, entry => entry.tokens)
)
// bad
const decodePart = Effect.fn('decodePart')(function* (part: Part) {
	return yield* Schema.decodeEffect(Event)(part)
}) // a span on an internal helper
const prompt = (message: Prompt.UserMessage): Effect.Effect<void, AiError> =>
	Effect.gen(function* () {
		yield* send(message)
	})
entries.sort((left, right) => left.tokens - right.tokens)
```

```ts
// good — Effect.fn with arguments, Effect.gen without
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage) {
	const input = yield* piUserMessage(message)
})
const stop = Effect.gen(function* () {
	yield* setStatus('stopping')
})
// bad — "if there is an arg you must use the Effect.fn"
read: input => pipe(storage.read(input.id), Effect.withSpan('Todo.read', {attributes: {id: input.id}}))
fetch: url => Effect.tryPromise(() => fetch(url))
const load = id =>
	Effect.gen(function* () {
		return yield* read(id)
	})
```

```ts
// good — a service with one implementation builds it inline in its layer; a service with several backends has one named layer per backend, like Ai.layerPi; an implementation is the service's of or a plain object that satisfies its shape
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('@deslop/ledger/service/Ledger') {
	static layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return Ledger.of({add, balanceByTag})
		})
	)
}
export declare namespace Ai {
	export type Agent = {
		readonly events: Stream.Stream<Event>
		readonly prompt: (message: Prompt.UserMessage) => Effect.Effect<void, AiError>
		readonly status: SubscriptionRef.SubscriptionRef<AiStatus>
		readonly stop: Effect.Effect<void>
	}
}
export class Ai extends Context.Service<Ai, Ai.Agent>()('@deslop/ai/service/Ai') {
	static layerPi(config: Pi.Config) {
		return Layer.effect(this, makePi(config))
	}
}
export const makePi = Effect.fnUntraced(function* (config: Pi.Config) {
	return {events: replay.events, prompt, status, stop} satisfies Ai.Agent
})
// bad — "in most cases i don't have a default implementation"
class Logger extends Context.Service<Logger>()('Logger', {make: Effect.succeed(service)}) {}
static readonly layer = Layer.effect(Ledger, makeLedger) // a make with one caller
query(sql: string): Effect.Effect<Rows> // a service method signature instead of a readonly property
```

```ts
// good — standalone pipe
trails: pipe(Schema.Array(PortfolioTrail), Schema.withConstructorDefault(Effect.succeed([]))),
const toolkit = yield* pipe(PiToolkit, Effect.provide(handlerContext))
```

```ts
// good — the Effect clone is searched before writing
BigDecimal.format(amount)
Schema.decode(SchemaTransformation.trim().compose(SchemaTransformation.toLowerCase()))
Duration.parts(DateTime.distance(oldest.timestamp, newest.timestamp)).days
Array.match(lines, {onEmpty: () => Option.none(), onNonEmpty: lines => Option.some(Array.join(lines, '\n'))})
// bad — hand-rolled what effect ships
const digits = BigDecimal.scale(BigDecimal.abs(amount), 2).value.toString().padStart(3, '0')
Schema.decode({decode: SchemaGetter.transform(String.toLowerCase), encode: SchemaGetter.passthrough()})
Math.floor(Duration.toDays(DateTime.distance(oldest.timestamp, newest.timestamp)))
```

```ts
// good — "fail fast instead of retrying"; one domain error per service, the only error its signatures name; the cause kept, mapped in the pipeline argument of Effect.fn with no .pipe after it; nothing caught
export class AiError extends Schema.TaggedError<AiError>()('AiError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}
const prompt = Effect.fn('Ai.prompt')(
	function* (message: Prompt.UserMessage) {},
	Effect.mapError(cause => AiError.make({cause, message: 'Cannot prompt the agent'}))
)
const content = yield * fs.readFileString(target)
const pages =
	yield *
	Effect.tryPromise({
		catch: cause => NotionError.make({cause, message: 'Cannot list pages'}),
		try: () => client.pages.list()
	}) // an SDK failing with unknown is mapped at the adapter, so no error channel carries unknown or any
Effect.mapError(cause => WorkspaceError.make({cause: Redacted.make(cause), operation: 'exec input'})) // a cause that may hold secrets stays redacted
Effect.tapError(() => cleanup) // work on failure that keeps the original error
// bad — "malformed output fails instead of becoming empty data"
const content =
	yield *
	pipe(
		fs.readFileString(target),
		Effect.catch(() => Effect.succeed(''))
	)
const config = yield * pipe(loadConfig, Effect.retry(Schedule.recurs(3)))
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped, new
Effect.catch(error => pipe(cleanup, Effect.andThen(Effect.fail(error)))) // fails again with the error it caught
load: (path: string) => Effect.Effect<void, PlatformError | Schema.SchemaError> // library failures leak from the service
```

```ts
// good — Option where a pipeline composes it; otherwise ?: and undefined stay plain
Option.map(Number.parse(event.target.value), field.handleChange)
// bad — "Option sporadically, when it makes the code cleaner"
const parsed = Option.getOrUndefined(Number.parse(event.target.value))
if (parsed !== undefined) field.handleChange(parsed)
```

```ts
// good — the primitive itself
const state = yield * SubscriptionRef.make(PortfolioState.make({}))
// bad — "not wrappers over the effect primitives, utils that compose with them"
class State {
	update(f: (s: PortfolioState) => PortfolioState) {
		return SubscriptionRef.update(this.ref, f)
	}
}
const traced = Effect.withSpan('Notes.create')(notes.create(input)) // rpcs and services already trace
```

```ts
// good — a Promise an external contract demands is bridged once, where it is returned
health: flow(rpc.health, Effect.runPromiseWith(Context.empty())),
// bad — a runtime or runner at module scope
const runtime = ManagedRuntime.make(AppLayer)
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)
```

```ts
// good — one scope owns the lifetime
const socket = yield * Effect.acquireRelease(openSocket, closeSocket)
// bad — acquisition and release with different owners
const socket = yield * openSocket
yield * Effect.addFinalizer(() => closeSocket(socket))
```

```ts
// good
const total = Number.sum(previous, value)
const next = Array.append(items, item)
Array.reduce(input.trails, HashMap.empty<string, Cell>(), (previousByVisitor, trail) => {
// bad — "as functional and immutable as possible"
let total = 0
for (const value of values) total = total + value
```

```ts
// good — the collection operation says what it selects
pipe(teamId, String.split(','), Array.map(String.trim), Array.findFirst(String.isNonEmpty))
pipe(path, String.split('/'), Array.findLast(String.isNonEmpty))
Array.filterMap(items, item => (supports(item) ? Result.succeed(item.value) : Result.failVoid))
yield * Effect.sleep(Duration.millis(delay))
// bad — a list built to take one element, a filter then a map, a Promise timer
const [first] = teamId
	.split(',')
	.map(value => value.trim())
	.filter(value => value.length > 0)
items.filter(item => supports(item)).map(item => item.value)
Effect.promise(() => new Promise(resolve => setTimeout(resolve, delay)))
```

## Shape

```ts
// good — inlined into its one use
function randomIndex(length: number) {
	return Random.Random.defaultValue().nextIntUnsafe() % length
}
// bad — "why is this extracted here? can't we just inline it?"
const random = Random.Random.defaultValue()
function randomIndex(length: number) {
	return random.nextIntUnsafe() % length
}
```

```ts
// good — a predicate, reused
const isApiUrl = Predicate.compose(String.isString, Predicate.or(Equal.equals('/api'), String.startsWith('/api/')))
// bad — "this is just a wrapper / factory function"
function isBackendRequest(request: IncomingMessage) {
	return isApiUrl(request.url)
}
```

```ts
// good — every step inlined; a function that reads no argument is a value, named once
static generateText = generateTextPi
pipe(config.endpoint, Schema.decodeUnknownEffect(Endpoint), Effect.flatMap(client))
Ref.set(entries, decoded)
const notFound = HttpServerResponse.empty({status: 404})
// bad — "wrapper function, tmp variable ... that can be inlined"
const runPromise = Effect.runPromiseWith(Context.empty())
const endpoint = yield* Schema.decodeUnknownEffect(Endpoint)(config.endpoint)
client(endpoint)
Ref.set(entries, Array.copy(decoded)) // decoded is already an array
```

```ts
// good — only what the caller varies
export type Config = {main: AiAgentDefinition; model: AiModel; toolkit: Toolkit.Toolkit<Ai.Tools>}
// bad — "things like the pollInterval shouldn't be configurable"
export type Config = {remote: GitRemote; token: Secret.Secret; pollInterval: Duration.Duration}
```

```ts
// good — an early return, one level deep, a blank line between groups
if (sandbox?.status !== 'running') return

return yield * sandbox.kill
// bad — "i hate unnecessary deep nesting, i like flat pipelines"
if (sandbox !== undefined) {
	if (sandbox.status === 'running') {
		return yield * sandbox.kill
	}
}
```

```text
// good — role folders with one naming scheme; each file a distinct role, tests beside their subject
src/rpcs/contracts.ts, src/rpcs/handlers.ts, src/routes/(home)/index.tsx
src/rules/no-typeof.ts, src/rules/no-constant-function.ts, src/rules/rules.test.ts
// bad — a barrel, near-empty files, and names that say nothing
src/index.ts, src/types.ts (one alias), src/constants.ts (one value), src/helpers/misc.ts
```

```ts
// good — a projection only where the target must not see the rest; linked state moves in one pure updater
upload({scope: input.scope, type: input.type}) // input also holds the bearer token
setState(current => {
	const draft = {...current.draft, files}
	return {draft, owner: ownerAfter(draft)}
})
// bad — an updater that calls another setter
setDraft(current => {
	setOwner(ownerAfter(current))
	return {...current, files}
})
```

## Quality

```ts
// good — the root cause removed in code; a package config is the shared preset alone; code a generator emits meets this skill and is linted like hand-written code
import {NodeRuntime} from '@effect/platform-node'
export {oxlint as default} from '@deslop/workflow'
// oxlint-disable-next-line @typescript-eslint/consistent-type-definitions -- TanStack Router augments this interface by name.
// bad — "why are we adding the exactOptionalPropertyTypes instead of fixing the code?"
"exactOptionalPropertyTypes": false
const warned = ['sort-keys', 'typescript/no-restricted-types'] // a package rule list
"typecheck": "tsc --noEmit" // type-aware lint already checks types; one command per job
// oxlint-disable-next-line @typescript-eslint/consistent-type-assertions   // no reason
// oxlint-disable-next-line sort-keys -- keeps the printed order   // an order-pinning rule
// bad — "why are we not disabling the cases with the ignore comments?"
files: ['packages/components/src/components/agent-browser.tsx', 'packages/components/src/components/form.tsx'],
// bad — "keep it enabled so other cases get fixed"
ignorePatterns: ['src/generated/**'] // generated code escapes lint
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {createServer} from 'node:http'
```

## Tests

A few tests, each guarding logic worth guarding, beat coverage: every test is code to read and maintain, and coverage is never a goal.

- Test logic the repository owns, its branching, computation, parsing, and state transitions, where a plausible regression breaks it and nothing else would catch it.
- Test at the seam, the exported layer, service, or function of a package or an app's service, as a black box: rewriting the implementation leaves every test green. The browser proves UI components; source tests leave them out.
- Leave untested what something else guarantees or what is not behavior: types and shapes tsc checks, rules a schema declares, the Effect runtime, a dependency, the platform or native JS, another tool's output, wiring that only shows a call reaching a double, constants and pinned counts, wording, removed or previous behavior, input no caller produces, and a second input for covered behavior. Delete such cases in every test file the change edits.
- Expected values come from an independent source, a literal the brief or a worked example gives, never a recomputation of what the code does.
- Touched logic worth a test that none covers gets a case, added before a refactor rewrites it.
- One input per behavior: prove a change with one input in the existing case that covers it; add a case only for unexercised behavior.
- Settle a worry about a case with a throwaway test or prototype run and delete it once answered; commit only tests that meet this bar.
- Reproduce a bug before fixing it; its failing case stays only when the fixed logic meets this section's bar, in the existing test covering the fixed code when there is one.
- Fixtures are the inputs the request names; without them, the smallest reachable input that exercises the behavior.
- Assert which input is flagged or returned, or an error's tag, code, or path; never wording or another tool's output.
- Doubles are Layers or a dependency the public function takes: no vi, global stub, or module mock, even at the network boundary.
- Seed inputs that make the logic decide; grow a test helper only when every case needs it.
- Tests assert with `assert` from `@effect/vitest`, never `expect`, as Effect's own tests do.
- A test never expects wrong behavior and never works around another rule; fix the conflict instead. An expectation changes only together with a recorded behavior change, never to make a check pass, and a changed assertion keeps every value the old one checked that still meets this section's bar, except wording.

```ts
// good — one input in the existing case, the request's fixture, the flagged input or error tag asserted, doubles passed in
Response.makePart('text-delta', {delta: '', id: 'empty'}),
'const [optional] = useState<string | undefined>(undefined)',
assert.deepStrictEqual(customCodes(result.stdout), [..., '@deslop/workflow(no-typeof)'])
assert.containsSubset(error, {_tag: 'SandboxUnavailable', cause: killed})
const workspace = connect(connection, workspaceFetch)
Layer.succeed(OpenSandbox, openSandbox)
const result = yield* lintSource({name: 'recursive.ts', source})
// bad — "1 userful test is better than 1000 useless ones"
it('skips empty deltas when reconstructing Prompt history', () => { /* 21 lines */ })
"import {Schema as S} from 'effect'" // not an input the request names
assert.isTrue(Array.some(diagnostics, d => d.code === 'typescript(TS2456)')) // another tool's output
expect(error).toMatchObject({_tag: 'SandboxUnavailable'}) // Vitest's expect
additional?: {name: string; source: string}[] // a helper option one case needs
```

```ts
// good — "test files only for the services/packages public interfaces"; one layer per file; a test asserts a value the brief specifies, such as its no-partial-data decision, never one a library computes
it.layer(Layer.provideMerge(Ledger.layer, NodeServices.layer))(test => {
	test.effect('keeps the previous entries when the file is malformed', () => run(program))
	test.effect('sums expenses negative per tag', () => run(program))
})
// bad — "this test is useless, it doesn't test that the agent is working"
it.effect('rejects an empty tag', () => run(ledger.add({tag: ''}))) // Schema.isNonEmpty already does
it.effect('loads', () => pipe(program, Effect.provide(Ledger.layer))) // the layer, per test
// bad — guaranteed elsewhere: a constant, a pinned count, a schema's own rule, a shape tsc checks, a removed field
assert.strictEqual(attioProvider.identifier, 'attio')
assert.strictEqual(Array.flatMap(attioProvider.groups, group => group.actions).length, 75)
assert.throws(() => Schema.decodeUnknownSync(WorkflowDraftVersion)(0)) // the schema declares positive integers
assert.property(HomeSummaryResponse.fields, 'alerts')
assert.notProperty(WorkflowRunDetailResponse.fields, 'nodeAttempts')
```

## Lint-enforced forms

When a rule seems to force worse code, write the Effect-correct form, or report the rule defect with a minimal repro; disable a rule inline only where the code has no other correct form, with its reason after `--`, and never silently write the worse form. An order-pinning rule, such as sort-keys, always has a correct form and is never disabled, inline included.

### Natives

```ts
// good — Effect owns the capability; a secret is Redacted, never a string
const fs = yield * FileSystem.FileSystem
const start = yield * Clock.currentTimeMillis
yield * Effect.logInfo('Portfolio client connected')
Random.Random.defaultValue().nextDoubleUnsafe()
Schedule.spaced(Duration.millis(55))
pipe(Config.String('HOST'), Config.withDefault('0.0.0.0'))
Config.Redacted('SMTP_PASS')
```

```ts
// good
const recipients = Array.ensure(input)
```

### Globals and types

Every property of a service shape, the second type argument of `Context.Service`, is readonly, as in Effect's services; class members may be readonly, such as `static readonly layer`; readonly appears nowhere else, except on a Schema.suspend cycle's hand-written types.

```ts
// good
Record.toEntries({claude: claudeHome, codex: codexHome})
HashMap.empty<string, number>()
HashSet.empty<string>()
Array.get(items, 0)
type Holder = {value: string[]; time: DateTime.Utc; error: ToolExecutionError}
const entries = yield * Ref.make(Array.empty<LedgerEntry>())
Schema.Struct({x: Schema.Finite})
```

### Expressions

```ts
// good
const root = options?.root ?? '.'
String.replaceAll(/[-_]+/gu, ' ')
const sorted = {a: 2, b: 1, c: 3}
```

### Programs

```ts
// good — the owned runtime runs
NodeRuntime.runMain(
```

### Modules

Import a module under its own name; the ui package's aliases for clashing names are the exception.

```ts
// good — subpath imports, import type, every export has an importer
import type {PortfolioState, PortfolioTrail, PortfolioVisitor} from '#rpcs/contracts.ts'
import type {Connect, EnvironmentModuleNode, Plugin} from 'vite'
// bad — each line is a diagnostic
import {Schema as S} from 'effect'
export const EntryKind = Schema.Literals(['income', 'expense']) // no importer
```

### React

```ts
// good — React Compiler memoizes; Atom holds logic
const editorRef = useRef<Lexical.LexicalEditor>(null)
const [showShortcuts, setShowShortcuts] = useState(false)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
```
