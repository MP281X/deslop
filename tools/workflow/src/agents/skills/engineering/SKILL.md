---
name: engineering
description: 'Use for product-code architecture, implementation, coding style, testing, or review.'
---

Write code to these rules; apply the repository's `project-engineering` skill where one exists. Both take precedence over a repository's other coding standards. Static analysis catches regressions and never fixes code: write every rule below correctly the first time, whether or not a linter checks it. The deslop codebase is the minimum bar for structure and consistency in every repository.

## Simplicity

Every line not needed now slows the next change. Build the smallest thing that does the requested job well:

- Write the plain, obvious solution, explicit and idiomatic, readable top to bottom: no comments, no clever tricks, and no indirection a single use does not need; inline every forwarding wrapper and every single-use helper or top-level const, as Shape shows.
- Keep code flat: flat pipelines and early returns instead of nesting, with a blank line between logical groups.
- Doing less than asked beats doing more: the core done well beats a complete 100% with extras; name what you cut. A refactor or cleanup request asks for depth instead: every section applies to every line of the owned files, not only the lines the diff changes.
- Write for where the code lives: extend the nearest existing implementation of the same kind, mirroring its permissions, errors, data refresh, and tests, and reuse the feature's helper for a job before writing one.
- Happy path only: let failures flow through Effect's error channel, with no catch, retry, fallback, or defensive check unless the request or an existing contract states the requirement.
- Validate and transform once, at the boundary, with Effect Schema; inside, data is trusted: carry narrowed values forward and never re-check what the schema, the declared type, an earlier filter, or tsc guarantees.
- Layers depend inward: domain and service code never import HTTP, RPC, or other transport types.
- Search Effect before writing logic: before hand-writing a traversal, accumulator, check, or config read, search the Effect clone the environment skill names (Graph, Record, String, Option, Struct, Config.all, Match, Boolean) and call the helper that exists.
- Never destructure a parameter, callback argument, or loop variable (`useState` excepted), and never re-list a value's fields: pass it whole or spread it.
- No future-proofing: no option, parameter, layer, abstraction, export, file, script, or check for a need that does not exist yet.
- Delete dead code, always: every superseded or unused file, export, type, doc, test, and dependency goes in the same change; keep the type half of a schema pair and leave no compatibility path or leftover.
- Replace every third-party dependency you can with an Effect module, or with a Node built-in reached through Effect's platform packages.
- Change only the state an action changes: refresh, invalidate, or rerender nothing else.
- Send and store canonical data only; derive the rest where it is used, and surface each state once, where the user acts on it.
- Touch only what the request needs; an unrelated improvement is a proposal for the user.
- Behave correctly instead of building machinery, such as hooks, guards, or generators, to enforce behavior.
- A refactor or mechanical pass keeps logic and behavior, except a difference that matters at no usage point and makes the code simpler: check every usage point, then record the difference, reported with the change. Any other behavior change is the user's decision, except a reachable bug's fix.
- Fix a reachable bug, one that real input from an actual usage point triggers: check every consumer of the changed output and report it as a fixed bug. Handling for input no caller produces is deleted instead of fixed; anything that looks intentional, or that other code relies on, is a proposal.
- Improve performance in the code the change touches where you know how; measure beyond noise on a realistic input only when a change claims speed or keeps a slower-looking form.
- Implement the definition the domain uses, such as a cycle for recursion, never the nearest syntactic proxy.
- Before finishing, reread the diff and delete every line the outcome does not require: pass values instead of trackers, use the whole schema instead of picking every field, and delete checks and fallbacks for cases callers cannot produce, props, options, and docs beyond the minimum, tests the Tests section drops, and code an Effect helper replaces.

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
// good — Effect's glob covers every usage point; the dropped dot-folder match is recorded and reported with the change
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
// good — only what a consumer imports
export {PetstorePlugin, PetstorePluginBase} from './generated/Plugin.ts'
// bad — the generated package exports every schema, action, and client internal; consumers import two names
export * from './generated/Client.ts'
export * from './generated/Plugin.ts'
```

```text
// good — one walker, the CLI's --help as its documentation, and nothing left behind
src/generator/resolve.ts
// bad — "code from previous iterations that isn't used or necessary anymore"
src/generator/resolve.ts, src/generator/referenceProblem.ts   // two $ref walkers after a rewrite
README.md, AGENTS.md, SKILL.md, sdk guide, changeset          // the same CLI flags five times
HANDOFF-openapi-plugin.md, ~/.ab/, stray worktrees            // artifacts left after "done"
```

```text
// good — the instruction states the behavior; each harness keeps its own plain file
// bad — "It seems stupid and overcomplicated to have a script for it"
scripts/ask-gate.mjs     // a hook forcing the order of questions
guard.py                 // enforces string checks the instruction already states
render-config.ts         // generates per-harness files from one source
```

## Types

```ts
// good — inferred; only a recursive function is annotated; satisfies and as const are the only assertions
const decoded = yield* Schema.decodeEffect(LedgerFile)(yield* fs.readFileString(path))
const balances = Array.reduce(decoded, HashMap.empty<Tag, BigDecimal.BigDecimal>(), sumByTag)
function visit(node: Node): Result {
	return visit(node.parent)
}
return Effect.succeed([{text: part.text, type: 'text'} satisfies TextContent])
export type Sandbox = ReturnType<typeof fromSdk>
// bad — "are you sure this doesn't infer everything?"
fn: RpcClient.runtime.fn<{onSuccess: (message: string) => void}>()(
const Input = Schema.Struct({value: Schema.String}) satisfies Schema.Schema<Input>
export type SandboxLike = {id: string; renew: (seconds: number) => Promise<unknown>} // a copy of an inferred shape
// bad — "the rest of the assertions should be banned"
const user = JSON.parse(text) as User
const parsed = value as Parsed
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
export const AiAgent = Schema.Literals(['pi'] as const)
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
function settle(amount: LedgerEntry['amount']) {
// bad — "the type ... same name ... the line before"
export const GitDiffStatus = Schema.Literals(['added', 'deleted', 'modified'])
export interface GitDiffStatusType {}
export type EntryDraft = {amount: EntryAmount; id?: EntryId; tag: string} // a hand-written shape beside the schema
function settle(amount: typeof LedgerEntry.Type['amount']) {
const Tag = Schema.NonEmptyString // no type pair
// bad — "all the Schema.Class should be replaced with Schema.Struct"
export class PortfolioVisitor extends Schema.Class<PortfolioVisitor>('PortfolioVisitor')({
	color: Schema.NonEmptyString
}) {}
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
// bad — "typeof X.Type is circular for a schema whose type passes through a Schema.suspend thunk naming X"
export type Step = typeof Step.Type
export const Step: Schema.Codec<Step> = Schema.Union([CallStep, CodeStep])
const StepArray: Schema.Codec<readonly Step[]> = Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step))
```

```ts
// good — the schema pair at module scope, decoded at the call site
type PackageManifest = typeof PackageManifest.Type
const PackageManifest = Schema.fromJsonString(
	Schema.Struct({dependencies: Schema.optional(Schema.Record(Schema.String, Schema.String))})
)
const manifest = yield * Schema.decodeEffect(PackageManifest)(yield * fs.readFileString(path))
// bad — "useless alias, harder to follow the code flow"
const decode = Schema.decodeUnknownEffect(Input)
const result = decode(input)
const ToolFailure = Schema.Defect()
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
// good — Schema, Array, String, Number, Predicate over globals; PackageManifest is a fromJsonString schema
Schema.decodeEffect(PackageManifest)(text)
Number.parse(input.count)
Array.map(commits, commit => commit.subject)
Predicate.isString(value)
// bad — "you shouldn't manually decode json without effect schema"
const payload = Schema.decodeUnknownSync(RequestPayload)(JSON.parse(body))
const count = parseInt(input.count)
commits.map(commit => commit.subject) // in tests too
typeof value === 'string'
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
const load = id =>
	Effect.gen(function* () {
		return yield* read(id)
	})
```

```ts
// good — a service with one implementation builds it inline in its layer; a service with several backends has one named layer per backend, like Ai.layerPi; an implementation returns a plain object
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('@deslop/ledger/service/Ledger') {
	static layer = Layer.effect(
		this,
		Effect.gen(function* () {
			return {add, balanceByTag} satisfies Ledger.Shape
		})
	)
}
export declare namespace Ai {
	export type Agent = {
		events: Stream.Stream<Event>
		prompt: (message: Prompt.UserMessage) => Effect.Effect<void, AiError>
		status: SubscriptionRef.SubscriptionRef<AiStatus>
		stop: Effect.Effect<void>
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
readonly add: (draft: LedgerDraft) => Effect.Effect<LedgerEntry, Schema.SchemaError>
return Ledger.of({add, balanceByTag}) // identity wrapper
```

```ts
// good — standalone pipe
trails: pipe(Schema.Array(PortfolioTrail), Schema.withConstructorDefault(Effect.succeed([]))),
const toolkit = yield* pipe(PiToolkit, Effect.provide(handlerContext))
// bad — ".pipe" method
const Tag = Schema.String.pipe(Schema.check(Schema.isNonEmpty()))
const toolkit = yield* PiToolkit.pipe(Effect.provide(handlerContext))
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
// bad — "malformed output fails instead of becoming empty data"
const content =
	yield *
	pipe(
		fs.readFileString(target),
		Effect.catch(() => Effect.succeed(''))
	)
const config = yield * pipe(loadConfig, Effect.retry(Schedule.recurs(3)))
export class LedgerError extends Data.TaggedError('LedgerError')<{readonly reason: string}> {}
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped, new
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
items.push(item)
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
const notFound = () => HttpServerResponse.empty({status: 404})
```

```ts
// good — only what the caller varies
export type Config = {main: AiAgentDefinition; model: AiModel; toolkit: Toolkit.Toolkit<Ai.Tools>}
// bad — "things like the pollInterval shouldn't be configurable"
export type Config = {remote: GitRemote; token: Secret.Secret; pollInterval: Duration.Duration}
```

```ts
// good — flat: an early return, one level deep, a blank line between logical groups
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
// good — kebab-case files named by role
src/schema.ts, src/open-sandbox-provider.ts
// bad — PascalCase, and two files splitting one role
src/Protocol.ts, src/Client.ts
```

## Quality

```ts
// good — the root cause removed in code; a package config is the shared preset alone
import {NodeRuntime} from '@effect/platform-node'
export {oxlint as default} from '@deslop/workflow'
// oxlint-disable-next-line @typescript-eslint/consistent-type-definitions -- TanStack Router augments this interface by name.
// bad — "why are we adding the exactOptionalPropertyTypes instead of fixing the code?"
"exactOptionalPropertyTypes": false
const warned = ['sort-keys', 'typescript/no-restricted-types'] // a package rule list; a package never turns off an order-pinning rule
"typecheck": "tsc --noEmit" // type-aware lint already checks types; one command per job
// oxlint-disable-next-line @typescript-eslint/consistent-type-assertions   // no reason
// bad — "why are we not disabling the cases with the ignore comments?"
files: ['packages/components/src/components/agent-browser.tsx', 'packages/components/src/components/form.tsx'],
// bad — "keep it enabled so other cases get fixed"
// @effect-diagnostics-next-line nodeBuiltinImport:off
import {createServer} from 'node:http'
```

## Tests

- Keep only tests that check logic a real regression would break, none breaking on an unrelated change; delete every test of wiring, types, library behavior, another tool's output, wording, a second input for covered behavior, or input no caller produces.
- Test through the package's public seam: its exported layer, service, or function.
- Touched logic no test covers gets a case, added before a refactor rewrites it.
- One input per behavior: prove a change with one input in the existing case that covers it; add a case only for behavior no case exercises.
- A bug fix first adds the case that fails without it, to the existing test that covers the fixed code when one exists.
- Fixtures are the inputs the request names, nothing else.
- Assert which input is flagged or returned, or an error's tag, code, or path; never wording or another tool's output.
- Doubles are Layers or a dependency the public function takes: no vi, global stub, or module mock, even at the network boundary.
- Seed inputs that make the logic decide; grow a test helper only when every case needs it.
- A test never expects wrong behavior and never works around another rule; fix the conflict instead. An expectation changes only together with a recorded behavior change, never to make a check pass.

```ts
// good — one input in the existing case, the request's own fixture, the flagged input or error tag asserted, doubles passed in, inputs that make the logic decide
Response.makePart('text-delta', {delta: '', id: 'empty'}),
'const [optional] = useState<string | undefined>(undefined)',
expect(customCodes(result.stdout)).toEqual([..., '@deslop/workflow(no-typeof)'])
expect(error).toMatchObject({_tag: 'SandboxUnavailable', cause: killed})
const workspace = connect(connection, workspaceFetch)
Layer.succeed(OpenSandbox, openSandbox)
const result = yield* lintSource({name: 'recursive.ts', source})
// bad — "1 userful test is better than 1000 useless ones"
it('skips empty deltas when reconstructing Prompt history', () => { /* 21 lines */ })
"import {Schema as S} from 'effect'" // not an input the request names
expect(Array.some(diagnostics, d => d.code === 'typescript(TS2456)')).toBe(true) // another tool's output
expect(error.message).toBe('Sandbox is gone') // wording
vi.spyOn(RequestAuthHeaders, 'withAuthForwardingHeaders').mockResolvedValue(new Headers())
vi.stubGlobal('fetch', stub) // the client takes fetch
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
vi.mock('../src/NotionClient.ts', () => ({})) // a Layer is the seam
```

## Lint-enforced forms

When a rule seems to force worse code, write the Effect-correct form, or report the rule defect with a minimal repro; disable a rule inline only where the code has no other correct form, with its reason after `--`, and never silently write the worse form.

### Natives

```ts
// good — Effect owns the capability; a secret is Redacted, never a string
const fs = yield * FileSystem.FileSystem
const start = yield * Clock.currentTimeMillis
yield * Effect.logInfo('Portfolio client connected')
Random.Random.defaultValue().nextDoubleUnsafe()
Schedule.spaced(Duration.millis(55))
pipe(Config.string('HOST'), Config.withDefault('0.0.0.0'))
Config.redacted('SMTP_PASS')
// bad — each line is a diagnostic
import {readFileSync} from 'node:fs'
const now = new Date()
const roll = Math.random()
const id = crypto.randomUUID()
const secret = process.env['SECRET']
const promise = fetch('https://example.com')
const timer = setTimeout(() => {}, 10)
console.log(stamp)
```

```ts
// good
const recipients = Array.ensure(input)
// bad — the ternary restates what Array.ensure already decides
const recipients = Array.isArray(input) ? input : [input]
```

### Globals and types

No readonly, except on a Schema.suspend cycle's hand-written types.

```ts
// good
Record.toEntries({claude: claudeHome, codex: codexHome})
HashMap.empty<string, number>()
HashSet.empty<string>()
Array.get(items, 0)
type Holder = {value: string[]; time: DateTime.Utc; error: ToolExecutionError}
const entries = yield * Ref.make(Array.empty<LedgerEntry>())
Schema.Struct({x: Schema.Finite})
// bad — each line is a diagnostic
const keys = Object.keys({a: 1})
const map = new Map<string, number>()
const set = new Set<string>()
const biggest = Math.max(1, 2)
const first = items[0]!
type Holder = {value: ReadonlyArray<string>; time: Date; error: Error; done: Promise<void>}
const entries = yield * Ref.make<readonly LedgerEntry[]>([])
interface Shape {
	readonly value: string
}
const inferrable: number = 1
const anyValue: any = 1
enum Color {
	Red
}
const Point = Schema.Struct({x: Schema.Number})
```

### Expressions

```ts
// good
const root = options?.root ?? '.'
String.replaceAll(/[-_]+/gu, ' ')
const sorted = {a: 2, b: 1, c: 3}
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
for (let index = 0; index < values.length; index++) {
	if (values[index] === 0) continue
}
input.value = 2
const unsorted = {b: 1, a: 2, c: 3}
```

### Programs

```ts
// good — the owned runtime runs
NodeRuntime.runMain(
// bad — each line is a diagnostic
const value = yield Effect.succeed(1)
try { return yield* Effect.succeed(value) } catch { return 0 }
const run = Effect.runPromise(program)
Effect.gen(async function* () {
```

### Modules

```ts
// good — subpath imports, import type, every export has an importer
import type {PortfolioState, PortfolioTrail, PortfolioVisitor} from '#rpcs/contracts.ts'
import type {Connect, EnvironmentModuleNode, Plugin} from 'vite'
// bad — each line is a diagnostic
import {useMemo} from 'react'
import {helper} from '../lib/utils.ts' // parent-relative; a sibling ./x.ts is fine
import {Ai} from '@deslop/ai/src/service.ts'
import {Schema} from 'effect' // used only as a type
export const Live = Effect.succeed(1)
export const EntryKind = Schema.Literals(['income', 'expense']) // no importer
export default helper
```

### React

```ts
// good — React Compiler memoizes; Atom holds logic
const editorRef = useRef<Lexical.LexicalEditor>(null)
const [showShortcuts, setShowShortcuts] = useState(false)
const moveRpc = useAtomSet(RpcClient.mutation('portfolio.move'))
// bad — each line is a diagnostic
const fake = useState(() => ({current: null}))
const state = useState(0) // not destructured
const ref = useRef<HTMLElement | null>(null)
const memo = React.useMemo(() => 1, [])
```
