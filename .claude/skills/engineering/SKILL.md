---
name: engineering
description: 'Use before writing or changing code, tests, scripts or configuration, before choosing how to build a feature, and before proving or testing behavior.'
---

# Engineering

Every file, flag, option, branch, abstraction and line answers one question: what breaks for the user without it? If nothing, remove it.

Agents write and maintain the code; people review it from the PR body, the proof and a scan of the diff. Write for that reader: idiomatic, effectful, testable code that reads in place, explicit and self-contained like Tailwind classes, so editing one part cannot break another. Fewer lines is never the goal: an abstraction stays only when it lowers what a reader must hold, never because it saves lines.

Oxlint and Oxfmt check every change and stay authoritative; this skill holds what they cannot check. Apply it with the repository's `CODING_STANDARDS.md`; a cleanup request applies every rule to every line of the owned files. Scratch code follows no style rule.

## Loop

- **Normalize.** Run the repository's fix command at the root before you analyze or check; a read-only reviewer never runs it.
- **First pass.** Write the forms in [Lint rules](#lint-rules) from the start. Fix a diagnostic at its source with the form its message names; never a cast, a weakened rule or a rewrite that trades one diagnostic for another.
- **Type early.** Check and test the package you change after each small batch of edits; the repository's full gate runs at the root before every push. Read an unfamiliar API's types in the installed version's source first. Fix the first error in each file first: one broken import turns into hundreds of implicit `any` errors downstream.
- **Disables** need an unavoidable conflict with an outside contract and a `--` reason naming it. Never disable ordering or weaken file configuration.

## Mechanism

Start from a real caller and the outcome, not a pattern. Trace one successful operation and its strongest reachable failure through the existing modules: the authoritative state, write boundary, resource lifetime and completion signal.

- **Direct.** The most direct code that meets today's request: extend the canonical example per [Patterns](#patterns), else a function or an existing service method. A new service only for a distinct capability or lifetime; reimplementing a library's job is a new mechanism. Keep the direct version unless a probe proves a concrete contract rules it out.
- **Callers.** Every function, parameter, option, export, Layer, check and config value has a caller that varies it. Handle reachable inputs only: no futureproofing or impossible cases. Explicit variants for genuinely different behaviors; no boolean combinations, registries, generic configuration or factories for hypothetical callers.
- **Reuse.** Search existing code, installed modules and Effect's modules by the domain concept, not only the request's words, before you write traversal, state, configuration or platform code; replace dependencies Effect covers. Identical logic twice (a computation, a query, an Effect pipeline) is one function in its owner's `lib/utils`. Similar code stays separate: three similar lines beat an abstraction, and a shared function never branches on its caller. Values, class lists and small expressions stay inline at each use, never in shared constants; reuse lives at the component, service or function level. Compose with Effect's own combinators, pipelines, Layers and Schema instead of writing a wrapper.
- **One owner.** Derive values from their owner; never mirror server state, request state, caches or pending results in another store. A persisted value has one write boundary, a domain enum one schema, a cache key the full identity it caches. No duplicate, subset or superset fields, methods, options or exports; remove states no caller produces.
- **Lifetime.** Finite work stays in its request scope; a stream serves progress without a job system. Background ownership only when work must outlive its caller.
- **Failure.** Failures flow through the error channel with their cause; never turn one into empty success. No catch, retry, fallback, idempotency or defensive check without a contract that needs it.
- **Trusted data.** Decode once at the boundary with Effect Schema; never re-check what the schema, the type or every caller guarantees.
- **Whole values.** Pass whole values or spread them, named by role; project fields only to withhold one, such as a bearer token.
- **Inward.** Domain and service code never import transport types; domain schemas carry no HTTP status.
- **Building blocks.** A public interface offers services, Layers and functions a caller composes, never a bundle such as `serve(app)`.
- **No compatibility.** Rename a shape and every caller together: no alias, fallback, deprecated path or flag. Persisted production data is the exception: a migration converts the stored data, and the code reads only the new shape.
- **Refactors** keep observable behavior at every consumer: capture the current output through the real interface before you change structure and compare it after; type checks and lint are not that capture. Report any difference. Fix reachable bugs inside the scope and check every consumer of the changed output.
- **Clarity.** Pure functions over immutable data, effects only inside Effect. Code reads top to bottom; rename or split instead of narrating; a comment only for an outside constraint the code cannot express.
- **Performance** only when the request needs it: locate the cost with a profiler or trace, measure one real action before and after with run count and variation, and treat a gap within the variation as no change.
- **Domain.** Implement the domain's definition, such as a cycle for recursion, never a syntactic proxy.
- **Dependencies.** A new one is `latest`; pin only what a consumer requires. Read its locked source before you wrap it; extend through its public API, never a patch.
- **Dead code.** In the same change, delete every superseded file, export, type, branch, config, doc, test, dependency and empty directory.

```ts
// good
const cycles = Graph.stronglyConnectedComponents(graph)
upload({scope: input.scope, type: input.type}) // input also holds the bearer token
// bad
Schema.decodeEffect(LedgerDraft)(draft) // draft is already a LedgerDraft
function save(kind: 'note' | 'tag', value: Note | Tag) {} // one helper branching per caller: saveNote and saveTag
import {glob} from 'glob' // Effect's FileSystem has glob
const digits = BigDecimal.scale(BigDecimal.abs(amount), 2).value.toString().padStart(3, '0') // BigDecimal.format
```

## Patterns

The repository stays consistent without a reminder; a standard changes everywhere at once.

- **Canonical example.** Before you write a recurring shape (page layout, list, form, empty or loading state, dialog, service, route, error mapping, file layout, name), find its canonical example: the Patterns row in `CODING_STANDARDS.md`, else the variant most consumers use, the newest on a tie. Copy its structure, components, names, copy and states.
- **Register.** A shape two consumers share without a row gets one: pattern, owner and example, a search listing its consumers, and what enforces it.
- **Taste.** The user's taste decides layout, file organization, boundaries, interfaces and names. Follow the Taste rows of `CODING_STANDARDS.md`; when the user picks, rejects or corrects an uncovered choice, add a row with the user's words in the same change.
- **Pattern change.** The user's change to a pattern, style or name changes the standard: update its owner (component, template, generator, lint rule, row), migrate every consumer its search lists, delete the old variant and search again. Another repository or a published contract needs the user's approval first.
- **Enforce.** The same correction twice becomes impossible at the highest level that works: an owner component or type, then a lint rule naming the replacement.

## Effect

**Functions.** `Effect.fn('Service.method')` for a traced function with arguments, `Effect.fnUntraced` for an internal helper, `Effect.gen` for statements without arguments, a single effect directly. `Effect.fn.Return` only for a generator that calls itself.

**Errors.** One `Schema.TaggedError` per service. Map in `Effect.fn`'s pipeline argument, redact secrets, map SDK errors at the adapter.

```ts
// good
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
// bad
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped
load: (path: string) => Effect.Effect<void, PlatformError | Schema.SchemaError> // library failures leak
```

**Services.** Inline a sole implementation in its Layer; name layers only for several backends. `Context.Reference` for a default; build the shape with `Service.of` or `satisfies`.

```ts
export class Ledger extends Context.Service<Ledger, Ledger.Shape>()('@app/ledger/service/Ledger') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const entries = yield* Ref.make(Array.empty<LedgerEntry>())
			return Ledger.of({add: add(entries), balanceByTag: balanceByTag(entries)})
		})
	)
}
export const Verbose = Context.Reference<boolean>('@app/ai/Verbose', {defaultValue: () => false})
```

- **Primitives.** RPCs and services already trace. One scope owns each lifetime, with acquisition and release in one `Effect.acquireRelease`.
- **Results.** Sort with `Order`; a fallible pure value returns a `Result`.

## Types and Schema

- **Derive** types from their source, such as `ReturnType<typeof fromSdk>`; use schema types and indexed members in signatures. Annotate a return type only on a guard, assertion, recursive function or `Schema.suspend` thunk.
- **Schema pairs.** `export type X = typeof X.Type` directly before `export const X = Schema.Struct(...)`; reuse fields by spreading `.fields`. `Schema.optionalKey` for an absent field; `Schema.optional` only for an explicit `undefined`.
- **Construction.** `X.make` validates and throws: trusted values only. Input that can fail uses `X.makeEffect`, mapped to the domain error.
- **Error predicates** are static members of their tagged error; check a struct inline with `Schema.is`.
- **Opaque** SDK input stays `unknown` until decoded at its boundary.

```ts
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
export type CallStep = {readonly do: readonly Step[]; readonly kind: 'call'}
export const CallStep = Schema.Struct({
	do: Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step)),
	kind: Schema.Literal('call')
})
```

## Shape

- **Linked state** moves in one pure updater, never a setter that calls another.
- **Files.** Kebab-case role names, one substantive file over near-empty fragments, `<name>.test.ts` beside its source.
- **Package surface.** Exports for imported subpaths, import aliases for internal paths. Extend the shared lint preset with generated ignores only.
- **Generated code** follows these rules as closely as it can; lint ignores it.

## React

- **Atoms.** Data, shared state and every Effect a component needs live in atoms; components read them with hooks and never run an Effect. Import `Atom` and `AsyncResult` from `effect/reactivity`, hooks from `@effect/atom-react`. Supply services through `Atom.runtime(layer)` and build reads and writes with its `atom` and `fn`; tie writes to reads with reactivity keys. Never wrap a write that already has an owner, such as an existing mutation, in a second state holder.
- **Outcomes.** Read with `useAtomSuspense`; the screen's owner wraps it in one `Suspense` and one error boundary with retry. Components never branch on loading or failure. A write's pending and failure state come from its atom; a reversible write updates at once with `Atom.optimistic`.
- **Ownership.** A component owning atoms, writes or a lifetime gets its own file.
- **Pure render.** Derive display values in render; event handlers own actions; `useEffect` only syncs external systems. Fix a rerender in the atom graph.

```tsx
const appsRuntime = Atom.runtime(DualApps.layer)
const appAtom = Atom.family((id: AppId) => pipe(appsRuntime.atom(loadApp(id)), Atom.withReactivity(['apps'])))
const saveAppAtom = appsRuntime.fn((draft: AppDraft) => saveApp(draft), {reactivityKeys: ['apps']})
function AppFrame(props: {appId: AppId}) {
	return <Frame app={useAtomSuspense(appAtom(props.appId)).value} />
}
```

## Proof

- **Probe first.** Answer a question or check an assumption with inline code against the public interface or real data: `vp node -e '<script>'`, `vp env exec bun -e '<script>'`. Never a test file, worktree, seam or `/tmp` script for one question.
- **Done** means each changed behavior and each of its consumers ran through its real interface on the final code: a screen in the browser, an API through a request, a CLI by running it; for a stack, on every layer's head. Never claim what you did not run. A green suite does not replace that run; zero collected tests or exit 0 alone prove nothing.
- **Bugs.** Reproduce before you fix, then shrink the reproduction until every remaining input, setting and step is needed. One hypothesis per probe. After two failed fixes, write down the premise they share and test it before a third. Rerun the original scenario after the fix.
- **Tests** only for complex logic you own, such as parsing, state transitions, concurrency, scheduling, money or data conversion: a black box through its public interface, expected values from the contract, never the implementation. One representative input per behavior; reachable distinctions only (empty, duplicate, concurrent, dependency failure).
- **No tests** for UI (the browser proves a screen); external libraries, APIs or SDKs; what types or schemas guarantee; inputs the architecture makes impossible; simple code (a filter, a mapping, wiring, a constant); an assumption (a probe answers it); a fixed bug (no regression tests); anything that changes when the implementation changes. Delete touched tests that break these rules.
- **Effect tests.** `assert` from `@effect/vitest`. `it.effect` runs virtual services, `it.live` real ones, `it.layer` caches a block's context. `TestClock` and `TestConsole` come from `effect/testing`: fork, await a `Deferred` at the dependency boundary, adjust time, join. Concurrency: an entered and release pair at the dependency. Expected failure: `Effect.flip`; both outcomes: `Effect.exit`; assert domain identity and preserved state.
- **Boundaries.** Replace dependencies through Layers or public parameters, never module mocks. A claim about an SDK, process, filesystem, HTTP, browser or package needs the real boundary. `FileSystem.layerNoop` is not storage; `RpcTest` bypasses serialization. A public tool is proved packed, not from source.
- **Evidence.** Keep the exact command, result and revision of each claim; rerun only proof whose inputs changed.

```ts
// good
it.layer(Layer.provideMerge(Ledger.layer, NodeServices.layer))(test => {
	test.effect('keeps the previous entries when the file is malformed', () => program)
})
assert.containsSubset(error, {_tag: 'SandboxUnavailable', cause: killed})
// bad
it.effect('rejects an empty tag', () => run(ledger.add({tag: ''}))) // Schema.isNonEmpty already does
it.effect('forwards the prompt', () => run(agent.prompt(message))) // wiring that only reaches a double
it('shows the empty state', () => render(<Notes notes={[]} />)) // a UI test: open the screen in the browser
assert.strictEqual(Array.flatMap(provider.groups, group => group.actions).length, 75) // a pinned count
```

## Critique

Once it works, reread the diff as a reviewer who knows only the request, and act on each answer before you call it done:

1. **Smaller?** Delete one part at a time (an edge-case branch, a check, an option, a helper, superseded code) and rerun the proof; keep only the parts whose removal breaks it.
2. **Existing?** Does the repository, a dependency or Effect already do any part of it?
3. **Consistent?** Does each recurring shape match its canonical example, and each name say its role?
4. **In place?** Can each changed file be understood without the chat or a jump to another file?
5. **Proved?** Which changed behavior or consumer has not run through its real interface?
6. **Expert?** What would a top expert in this area change, and what did the request imply that the diff skips?

## Lint rules

Lint rejects the right column without an autofix. Write the left column from the start.

| Write                                                                                                                | Never                                                                                                       | Rule                                                                                                                              |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| An early `return`, `Boolean.match(x, {onFalse, onTrue})`, `Option.match` or a lookup record                          | `a ? b : c`, in JSX too                                                                                     | `no-ternary`                                                                                                                      |
| `options?.root ?? '.'`                                                                                               | `root !== undefined ? root : '.'`                                                                           | `no-nullish-ternary`, `prefer-nullish-coalescing`                                                                                 |
| `pipe(Match.value(event), Match.tag('Text', text), Match.exhaustive)`                                                | `switch`                                                                                                    | `no-switch-statement`                                                                                                             |
| `selected === true` on a value that can be `undefined`; `ref.current === null`, `editor === undefined`               | `if (selected)` on an optional, `if (!ref.current)`, `if (editor)`                                          | `strict-boolean-expressions`                                                                                                      |
| `Array.filter` before the loop, an early `return` in a callback                                                      | `continue`                                                                                                  | `no-continue`                                                                                                                     |
| At most 3 nested blocks, 6 nested callbacks and 3 nested `pipe` calls                                                | Deeper nesting                                                                                              | `max-depth`, `max-nested-callbacks`, `no-deep-pipe`                                                                               |
| `pipe(value, f, g)`                                                                                                  | `value.pipe(f, g)`                                                                                          | `no-restricted-properties`                                                                                                        |
| `const total = Array.reduce(values, 0, Number.sum)`                                                                  | `let` with a loop                                                                                           | `no-let`                                                                                                                          |
| `Array.join(parts, ', ')`, `Array.map(items, f)`, `String.split(text, ',')`, `Record.keys(record)`                   | `parts.join(', ')`, `items.map(f)`, `text.split(',')`, `Object.keys(record)`                                | `no-native-method-call`, `no-restricted-globals`; the `Path` service's `path.join` stays                                          |
| `Predicate.isString(v)`, `Predicate.hasProperty(node, 'tag')`, `Predicate.isNotNullish(v)`                           | `typeof`, `'tag' in node`, `v !== null && v !== undefined`                                                  | `no-typeof`, `no-in-operator`, `no-double-nullish-check`                                                                          |
| `Predicate.isNotNullish`, `Predicate.isObject`, `Predicate.isDate` passed directly                                   | A hand-written guard `(v): v is T => v !== null`                                                            | `no-hand-written-guard`                                                                                                           |
| `Array.isReadonlyArrayEmpty(items)`, `String.isNonEmpty(text)`                                                       | `items.length === 0`, `text.length > 0`                                                                     | `no-native-emptiness-check`                                                                                                       |
| `Array.ensure(value)`                                                                                                | `Array.isArray(value) ? value : [value]`                                                                    | `no-array-wrap-ternary`                                                                                                           |
| `Option.map(option, f)`, `Option.match`, `Option.getOrElse`                                                          | `option.value` after `Option.isSome`                                                                        | `no-option-value-access`                                                                                                          |
| `undefined`, `Option.getOrUndefined`                                                                                 | `null`, `Option.getOrNull`, except for an outside contract                                                  | `unicorn/no-null`, `no-restricted-properties`                                                                                     |
| `Number.parse(text)`, `Number.max`, `HashMap`, `HashSet`, `DateTime`                                                 | `parseInt`, `Math.max`, `Map`, `Set`, `Date`                                                                | `no-restricted-globals`, `no-restricted-properties`, `no-restricted-types`                                                        |
| `Clock`, `Config`, `Console`, `Random`, `Effect.sleep`, `HttpClient`                                                 | `Date.now()`, `process.env`, `console`, `setTimeout`, `fetch`                                               | `effecttsgo/global-*`, `effecttsgo/process-env`                                                                                   |
| `FileSystem`, `Path`, `ChildProcess`, `Crypto`'s `randomUUIDv4`                                                      | `node:fs`, `node:path`, `node:child_process`, `crypto.randomUUID()`                                         | `effecttsgo/node-builtin-import`, `effecttsgo/crypto-random-uuid`                                                                 |
| `#lib/utils` through the package's `imports` map, named imports, named exports                                       | `../lib/utils`, `import * as utils from '#lib/utils'`, `export default` outside config files, a `namespace` | `import/no-relative-parent-imports`, `import/no-namespace`, `import/no-default-export`, `typescript/no-namespace`                 |
| `import {Folder} from 'lucide-react'` from the defining module                                                       | `export * from 'lucide-react'`, a file that only re-exports                                                 | `no-barrel-module`                                                                                                                |
| Kebab-case file names                                                                                                | `LedgerView.tsx`, `ledger_view.ts`                                                                          | `unicorn/filename-case`                                                                                                           |
| A name an outer scope does not use                                                                                   | An inner `entry` shadowing an outer `entry`                                                                 | `no-shadow`                                                                                                                       |
| A new value                                                                                                          | Assigning to a parameter or its properties                                                                  | `no-param-reassign`                                                                                                               |
| `/pattern/u`                                                                                                         | A regular expression without the `u` or `v` flag                                                            | `require-unicode-regexp`                                                                                                          |
| Strings, numbers and booleans in a template literal                                                                  | An object, `Option` or `unknown` value interpolated                                                         | `typescript/restrict-template-expressions`, `typescript/no-base-to-string`                                                        |
| A check only where the type allows both outcomes                                                                     | `?.`, `??` or a condition on a value whose type rules one outcome out                                       | `typescript/no-unnecessary-condition`                                                                                             |
| A type parameter that links two positions                                                                            | A type parameter used once, `string \| 'id'`, `void` in a union or parameter                                | `typescript/no-unnecessary-type-parameters`, `typescript/no-redundant-type-constituents`, `typescript/no-invalid-void-type`       |
| `items => service.load(items)`                                                                                       | `service.load` passed unbound                                                                               | `typescript/unbound-method`                                                                                                       |
| An Effect (`Effect.fn`, `Effect.tryPromise`); in `.tsx` only, an `async` handler that awaits                         | An `async` function in `.ts`, `async` without `await`, `void promise`, an unhandled promise                 | `effecttsgo/async-function`, `typescript/require-await`, `no-void`, `typescript/no-floating-promises`                             |
| The current API its deprecation names                                                                                | A deprecated API                                                                                            | `typescript/no-deprecated`                                                                                                        |
| Values decoded with Schema before use                                                                                | Member access, calls, assignments, arguments or returns on `any`                                            | `typescript/no-unsafe-*`                                                                                                          |
| `function name() {}` for a named function; an arrow only in place                                                    | `const name = () => {}`                                                                                     | `func-style`                                                                                                                      |
| `server => ({...server, warmup})`, `for (const schema of schemas)`, `pair => pair[0]`                                | `({host, port}) =>`, `for (const {name} of schemas)`                                                        | `no-destructured-parameter`; labeled tuples, React state and refs can destructure                                                 |
| `Array.sort(entries, Order.mapInput(Order.Number, (entry: Entry) => entry.tokens))`                                  | `entries.sort((left, right) => left.tokens - right.tokens)`                                                 | `no-native-method-call`; a third-party object's own method stays                                                                  |
| The source value where it is used                                                                                    | A one-line wrapper, alias or argument-free constant function                                                | `no-trivial-indirection`, `no-constant-function`                                                                                  |
| `import {Schema} from 'effect'`                                                                                      | `import {Schema as S} from 'effect'`                                                                        | `no-renamed-import`                                                                                                               |
| Properties built with `Effect.fn` or `Effect.fnUntraced`                                                             | `fetch: url => Effect.tryPromise(...)` as a property arrow                                                  | `no-effect-property-arrow`                                                                                                        |
| Inferred return and variable types, `satisfies`, `Array.empty<T>()`                                                  | `function f(): T`, `const items: T[] = []`                                                                  | `no-return-type`, `no-redundant-variable-annotation`                                                                              |
| `satisfies T`, `as const`                                                                                            | `as T`, `any`, `value!`                                                                                     | `consistent-type-assertions`, `no-explicit-any`, `no-non-null-assertion`                                                          |
| `useRef(initial)` for lifecycle state                                                                                | `const [box] = useState(() => ({current: initial}))` with no setter                                         | `no-fake-ref-state`                                                                                                               |
| `Ref.make(0)`, `useState(false)`, `useRef<HTMLDivElement>(null)`                                                     | `Ref.make<number>(0)`, `useRef<HTMLDivElement \| null>(null)`                                               | `no-redundant-state-type`, `no-redundant-use-ref-null-type`                                                                       |
| `T[]`, an optional property                                                                                          | `Array<T>`, `Promise<T>`, `x: T \| undefined`                                                               | `no-restricted-types`                                                                                                             |
| `Effect.tryPromise({catch: cause => X.make({cause, message}), try})`, each failure typed by its tagged error         | `unknown` or `any` in the error or requirements channel, a `catch` returning the raw cause                  | `effecttsgo/any-unknown-in-error-context`, `effecttsgo/unknown-in-effect-catch`                                                   |
| `Effect.mapError(cause => X.make({cause, message}))`                                                                 | `Effect.mapError(failure => X.make({message}))`, `catch: failure => X.make({message})`                      | `preserve-error-cause`                                                                                                            |
| The failure in the error channel; `Effect.option` for a value that is optional by design                             | `Effect.orElseSucceed(() => [])`, `Effect.catch(() => Effect.void)`, `Effect.succeed('')` in a catch        | `no-empty-recovery`                                                                                                               |
| `Effect.forEach(items, load, {concurrency: 'unbounded'})`; `{concurrency: 1}` when order or a resource matters       | `Effect.forEach(items, load)`, `Effect.all([a, b])`, `Effect.all(effects, {discard: true})`                 | `explicit-effect-concurrency`                                                                                                     |
| `Effect.fn('Service.method')` for a function returning an Effect                                                     | A plain function returning `Effect.gen`                                                                     | `effecttsgo/effect-fn-opportunity`                                                                                                |
| Layers provided once at the entry point; `Layer.provide` between layers                                              | `Effect.provide(layer)` inside services or per call                                                         | `effecttsgo/strict-effect-provide`                                                                                                |
| `Layer.provideMerge` when one layer needs another                                                                    | `Layer.mergeAll` of layers that depend on each other                                                        | `effecttsgo/layer-merge-all-with-dependencies`                                                                                    |
| One `pipe(value, f, g, h)`                                                                                           | `pipe(pipe(value, f), g)`, `pipe(value)`                                                                    | `effecttsgo/unnecessary-pipe-chain`, `effecttsgo/unnecessary-pipe`                                                                |
| Service keys `@<package>/<path>/<Name>`; an error's tag is its class name                                            | A service key that does not match the package, path and class name                                          | `effecttsgo/deterministic-keys`                                                                                                   |
| `return yield* NotFound.make({...})`                                                                                 | `yield* Effect.fail(NotFound.make({...}))`                                                                  | `effecttsgo/unnecessary-fail-yieldable-error`                                                                                     |
| `Schema.decodeEffect(S)(typed)`, `Schema.fromJsonString(S)` for JSON text                                            | `Schema.decodeUnknownEffect` on typed input, `JSON.parse` in an Effect                                      | `effecttsgo/prefer-typed-schema-decoder`, `prefer-schema-over-json`                                                               |
| `Schema.fromJsonString(Protocol)` with the protocol's schema                                                         | `Schema.UnknownFromJsonString`, `Schema.fromJsonString(Schema.Unknown)`                                     | `no-unvalidated-json-decode`                                                                                                      |
| `export type X = typeof X.Type` directly before `export const X`; an inferred schema                                 | A type elsewhere, `Schema.Schema<X>` restated, an unannotated `suspend` thunk                               | `schema-type-pair`                                                                                                                |
| `X.make(...)`, `Schema.is(X)(value)`, `Schema.decodeEffect` inside an Effect, `Schema.Finite` for numbers            | `new X(...)` on a schema class, `instanceof X`, `Schema.decodeSync` in a generator, `Schema.Number`         | `effecttsgo/new-schema-class`, `effecttsgo/instance-of-schema`, `effecttsgo/schema-sync-in-effect`, `effecttsgo/schema-number`    |
| The Schema operation inline at its use                                                                               | `const decode = Schema.decodeEffect(S)` stored for later                                                    | `no-stored-schema-operation`                                                                                                      |
| `Schema.Struct`, `Schema.TaggedError`, `Schema.NonEmptyString`                                                       | `Schema.Class`, `Data.TaggedError`, `Error`, a rebuilt refinement                                           | `no-restricted-properties`, `no-restricted-globals`, `no-reinvented-schema`                                                       |
| The failure mapped to the service's error                                                                            | `Effect.ignore`, `Effect.orDie` outside tests                                                               | `no-discarded-failure`                                                                                                            |
| `NodeRuntime.runMain(program)`; atoms in React                                                                       | `Effect.runPromise`, `ManagedRuntime.make`                                                                  | `no-restricted-properties`                                                                                                        |
| `import {useState} from 'react'`; `const [open, setOpen] = useState(false)`                                          | `React.useState`, `const state = useState(false)`                                                           | `no-restricted-properties`, `no-undestructured-use-state`                                                                         |
| React Compiler memoization, a `ref` prop                                                                             | `useCallback`, `useMemo`, `memo`, `forwardRef`                                                              | `no-restricted-imports`                                                                                                           |
| Code the compiler accepts                                                                                            | `'use no memo'`, an inline disable of a React rule                                                          | `no-compiler-opt-out`, `react/rule-suppression`                                                                                   |
| `const countAtom = Atom.make(0)` at module level, `Atom.family(id => ...)` per prop                                  | `Atom.make` inside a component or hook, `useState(() => Atom.make(0))`                                      | `no-component-atom-allocation`                                                                                                    |
| `<Editor key={draft.id} />` to reset a draft; a value derived in render                                              | A `useEffect` that copies a prop into state                                                                 | `react-doctor/no-adjust-state-on-prop-change`, `react-doctor/no-derived-state`                                                    |
| `<Label htmlFor="name">`, `aria-label` on a field without a visible label, a `<Button>` for a click                  | A placeholder as the only label, `<div onClick>`                                                            | `jsx-a11y/*`, `react-doctor/no-placeholder-only-field`                                                                            |
| `bg-card`, `border`                                                                                                  | `bg-linear-to-b from-muted`, `bg-[radial-gradient(...)]`                                                    | `no-gradient`                                                                                                                     |
| `duration-200`, `zoom-in-95`, `starting:scale-95`, `motion-safe:animate-spin`                                        | `duration-500`, `zoom-in`, `starting:scale-50`, an ungated `animate-bounce`                                 | `motion-limits`, `react-doctor/no-ungated-tailwind-animation`                                                                     |
| Tailwind's scale and the theme's tokens: `w-64`, `text-sm`, `bg-primary`; `className` on a primitive for layout only | `w-[312px]`, `text-blue-500`, `style={{...}}`, an unknown class, a primitive restyled                       | `shadcn/no-arbitrary-values`, `shadcn/no-raw-colors`, `shadcn/no-inline-styles`, `shadcn/no-unknown-classes`, `shadcn/no-restyle` |
| The UI package's primitive                                                                                           | A styled native `<button>` or `<input>`                                                                     | `no-native-control`                                                                                                               |
| `assert` from `@effect/vitest`, the failure's identity                                                               | `expect`, `vi`, an assertion on message wording                                                             | `no-restricted-imports`, `no-error-message-assertion`                                                                             |
| One comment line for an outside constraint                                                                           | A multiline comment                                                                                         | `no-multiline-comment`                                                                                                            |
| Object keys in ascending order; a blank line starts a new group                                                      | Unsorted keys, a `sort-keys` disable                                                                        | `sort-keys`, `no-unexplained-disable`                                                                                             |

Forms that satisfy every rule where the obvious fix trades one diagnostic for another:

```ts
// A handler used twice: a function declaration, not a const arrow.
function label(entry: Entry) {
	return Boolean.match(entry.done, {onFalse: () => 'Running', onTrue: () => 'Done'})
}
// Two nested loops: one loop over the pairs, not a sixth nested callback.
Effect.forEach(Array.cartesian(cases, harnesses), pair => prepareRun(pair[0], pair[1]), {concurrency: 'unbounded'})
// Cleanup on failure: its own failure flows, without Effect.orDie or Effect.ignore.
pipe(
	prepareRuns,
	Effect.onExitIf(Exit.isFailure, () => fs.remove(directory, {recursive: true}))
)
// A choice inside a deep pipeline: a named function, not a nested Boolean.match.
Array.appendAll(base, toolParts(tools, hasTools))
```
