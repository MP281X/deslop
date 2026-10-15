---
name: engineering
description: 'TypeScript and Effect code conventions paired with shared lint. Use when designing, implementing or reviewing product and test code, including prototypes.'
---

Oxlint and Oxfmt check every change and stay authoritative. This skill holds what they cannot check, and the forms they require without an autofix, to reduce first-pass corrections. Apply it with the repository's `CODING_STANDARDS.md`. A refactor or cleanup request applies every rule to every line of the owned files. Scratch code outside the repository follows no style rule.

- **Normalize.** Run the repository's fix command, or Oxfmt and the deterministic lint autofix, on the owned scope before you analyze code, review it or run a check-only lint. Automatic fixes need no model iteration; analyze only the diagnostics that remain. For a read-only review, the author normalizes and the reviewer never writes the checkout.
- **First pass.** Write the [Lint forms](#lint-forms) from the start. Fix a remaining diagnostic at its source with the form its message or the table names. Never use a cast, a weakened rule or a rewrite that trades one diagnostic for another.
- **Type early.** Type errors cause most fix loops: run the repository's check after each small batch of edits, not once after the whole feature. Read the types of an API you have not used in the installed version's source before you call it. Fix the first error in each file first: one unresolved type or import turns into hundreds of implicit `any` errors, such as TS7006 and TS7031, in every consumer.
- **Disables.** An inline disable needs an unavoidable conflict with an outside contract and a `--` reason that names it. Never disable ordering or weaken file configuration. Report dependency-only diagnostics; rename filename violations.

## Simplicity

- **MVP.** Write the most direct code that meets the request today. Apply YAGNI to every file, function, branch, parameter, option, export, Layer, check, config value, library and abstraction; configure only what callers vary. Write pure functions over immutable data, effects only inside Effect.
- **Plan the shape.** Before writing, choose the file tree, entrypoints and the smallest mechanism per feature from the canonical examples in [Patterns](#patterns). Use architecture for a new boundary, state owner, background lifetime, dependency or storage contract.
- **Clarity.** Code, names and files read top to bottom. Rename or split code instead of narrating it. Write a comment only for an outside constraint that names, types and control flow cannot express.
- **Reuse first.** Check existing code, installed modules and platform capabilities before you add code. Extend the canonical example: match its permissions, errors, refresh and tests, and reuse its helpers.
- **Effect first.** Search the cloned Effect modules before you hand-write traversal, state, configuration or platform operations, and replace dependencies that Effect or its platform adapters cover.
- **Inward dependencies.** Domain and service code never import HTTP, RPC or other transport types, and domain schemas carry no transport annotation such as an HTTP status.
- **Building blocks.** Design a new public interface from a realistic caller operation and its ordering, failure and lifetime obligations. Offer services, Layers and functions that the caller composes like any Effect module, never a bundle such as `serve(app)`.
- **Behavior kept.** A refactor keeps observable behavior at every consumer; printed diagnostics are not a contract. Accept only a difference that no consumer observes or that a rule here causes, such as an error that now keeps its cause, and report it; any other behavior change needs the request.
- **Reachable bugs.** Fix a bug that real input reaches inside the request's scope, and check every consumer of the changed output. Delete handling only for input the contract excludes; keep and report code that looks intentional.
- **Performance.** Optimize only when the request or a contract needs it. Measure one real action on realistic input before and after, where the symptom shows: spans for backend calls, React commits for rerenders, a browser profile for main-thread work. Report run count and variation; a difference within noise is unproved.
- **Domain.** Implement the definition the domain uses, such as a cycle for recursion, never the nearest syntactic proxy.
- **Happy path.** Failures flow through the error channel: no catch, retry, fallback or defensive check unless the request or a contract needs it.
- **Trusted data.** Decode once at the boundary with Effect Schema and carry the narrowed value forward. Never re-check what the schema, the declared type, an earlier filter or every caller guarantees.
- **Whole values.** Pass whole values or spread them, named by their role. Project fields only to keep data from a recipient that must not get it, such as a bearer token. When a name shadows an outer one, rename by role; never add an underscore or a number.
- **Options.** Use Option where it composes with other Option operators; keep a plain optional value otherwise.
- **Once.** One fact has one owner: extract repeated logic once, give a domain enum one schema, and give a cache or atom family key the full identity of what it caches.
- **One way.** No duplicate, subset or superset fields, methods, options or exports. Store and send canonical data, derive display values, expose each state once and remove states no caller produces.
- **No compatibility.** Rename the shape and every caller together. No alias, fallback, deprecated path or flag unless a documented or user-named contract requires it.
- **Dependencies.** Declare a new dependency as `latest`; pin only versions a consumer requires. Read the locked version's upstream source before you add a wrapper or workaround, and extend it through its public API, never a patch.
- **Dead code.** In the same change, delete every superseded or unused file, folder, export, type, branch, config, validation, doc, test and dependency, and the empty directories that remain. Update docs and generated bundles that describe changed behavior.

```ts
// good
const sandboxGone = Effect.mapError(cause => SandboxError.make({cause, message: 'The sandbox is gone'}))
const cycles = Graph.stronglyConnectedComponents(graph)
upload({scope: input.scope, type: input.type}) // input also holds the bearer token
// bad
Schema.decodeEffect(LedgerDraft)(draft) // draft is already a LedgerDraft
import {glob} from 'glob' // Effect's FileSystem has glob
const digits = BigDecimal.scale(BigDecimal.abs(amount), 2).value.toString().padStart(3, '0') // BigDecimal.format
```

## Patterns

Keep the repository consistent by default, without a reminder, and change a standard everywhere at once.

- **Canonical example.** Before you write a recurring shape, such as a page layout, list, form, empty or loading state, dialog, service, route, error mapping, file layout or name, find its canonical example: the row in the Patterns section of `CODING_STANDARDS.md`, else the variant that most current consumers use, the newest one on a tie. Copy its structure, components, names, visible terms, copy and states. Depart from it only on request.
- **Register.** When a task settles a shape that two or more consumers share and no Patterns row covers it, add one: the pattern, its owner and canonical example, a search that lists its consumers, and what enforces it.
- **Taste.** The user's taste decides layout, visual design, file organization, module boundaries, public interfaces and names. Read the Taste section of `CODING_STANDARDS.md` first and follow its rows like Patterns rows; decide a choice that no row settles from the closest rows. When the user picks, rejects or corrects a choice that no rule covers, add a row in the same change: the area, the choice, the rejected alternative and his words. Create a missing `CODING_STANDARDS.md` only to hold a Patterns or Taste row. A row that recurs across repositories moves into the owning skill.
- **Pattern change.** A user change to a pattern, style, name or convention changes the repository standard unless he limits its scope. In the same change, update its owner (shared component, template, generator, lint rule and Patterns row), migrate every consumer that the row's search lists, delete the superseded variant and its exemptions, and run the search again. Report each consumer kept on purpose. A migration across another repository or a published contract needs the user's approval first.
- **Enforce.** When the same correction happens twice, make the mistake impossible at the highest level that works: an owner component, export or type, then a lint rule whose message names the replacement, then a test. Keep a prose rule only for a judgment that no check can make. Prove a new check against the real past mistake and an accepted control.

## Effect

**Functions.** Use `Effect.fn('Service.method')` for a traced function with arguments, `Effect.fnUntraced` for an internal helper, `Effect.gen` for several statements without arguments, and a single effect directly. Use `Effect.fn.Return` only for a generator that calls itself.

```ts
const prompt = Effect.fn('Ai.prompt')(function* (message: Prompt.UserMessage) {
	const input = yield* piUserMessage(message)
	yield* send(input)
})
const decodePart = Effect.fnUntraced(function* (part: Part) {
	return yield* Schema.decodeEffect(Event)(part)
})
const restart = setStatus('starting')
```

**Errors.** One `Schema.TaggedError` per service. Map in `Effect.fn`'s pipeline argument, keep the cause, redact secrets, and map SDK errors at the adapter, so library failures never leak from the service.

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
pipe(
	fs.readFileString(target),
	Effect.catch(() => Effect.succeed(''))
)
Effect.mapError(failure => new LedgerError({reason: failure.message})) // cause dropped
load: (path: string) => Effect.Effect<void, PlatformError | Schema.SchemaError> // library failures leak
```

**Services.** Inline a sole implementation in its Layer; name layers only for several backends. Use `Context.Reference` for a default. Build the shape with `Service.of` or `satisfies`.

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

**Primitives.** Use Effect's primitives directly: RPCs and services already trace, and one scope owns each lifetime, with acquisition and release in one `Effect.acquireRelease`. Run independent input and output with `Effect.all` or `Effect.forEach` and explicit concurrency; keep order-dependent, transactional or conflicting work sequential.

**Failures.** Yield a yieldable domain error directly in a generator: `return yield* E.make(...)`. Use `Effect.fail(error)` for an error that is not yieldable, and for every error outside a generator. Factory-call syntax does not show yieldability; the type does.

**Results.** Sort with `Order`, and return a fallible pure value as a `Result`.

**Runtime.** The entry point runs `NodeRuntime.runMain(program)`. Bridge to a Promise once, where an outside contract demands it, with `Effect.runPromise` and a disable that names the contract. React is no such contract: atoms run its Effects.

## Types and Schema

- **Inference.** Infer types, and check a returned object with `satisfies`. Type an empty or one-element array with `Array.empty<T>()` or `Array.of<T>(...)`. Never drop a generic or loosen an exported type to silence an error. Annotate a return type only on a type guard, an assertion function, a recursive function or a recursive `Schema.suspend` thunk. Use schema types and indexed members, such as `LedgerEntry['amount']`, in signatures. Keep an intentional widening, such as `useState<'idle' | 'running'>('idle')`. Derive a type from its source, such as `ReturnType<typeof fromSdk>`; never copy an inferred shape by hand.
- **Schema pairs.** Write `export type X = typeof X.Type` directly before `export const X = Schema.Struct(...)`; reuse fields by spreading `.fields`. Use `Schema.optionalKey` for an absent field; reserve `Schema.optional` for an explicit `undefined`.
- **Construction.** `X.make` validates synchronously and throws: use it for trusted values. For input that can fail a refinement, use `X.makeEffect` and map its issue to the owning domain error.
- **Cycles.** Handwrite each recursive-cycle type and annotate only its `Schema.suspend` thunk; other types stay inferred, and a union follows its members.
- **Error predicates.** A predicate is a static member of its tagged error; check a struct inline with `Schema.is`.
- **Casts.** Opaque SDK and framework inputs stay `unknown` until decoded at their boundary; never fabricate a shape or erase a known shape into `unknown`.

```ts
export type LedgerDraft = typeof LedgerDraft.Type
export const LedgerDraft = Schema.Struct({...LedgerEntry.fields, id: Schema.optionalKey(Schema.NonEmptyString)})
export type CallStep = {readonly do: readonly Step[]; readonly kind: 'call'}
export const CallStep = Schema.Struct({
	do: Schema.Array(Schema.suspend((): Schema.Codec<Step> => Step)),
	kind: Schema.Literal('call')
})
pipe(
	Name.makeEffect(input),
	Effect.mapError(cause => NameError.make({cause, message: 'Invalid name'}))
)
```

## Shape

- **Inline.** Inline forwarding wrappers, temporaries, constants and property aliases; keep an alias only where a callback needs its narrowed type. Inline a small helper with one caller; a helper that several files share lives in the package's `lib/utils`. An argument-free function is a named value.
- **Linked state.** Linked state moves in one pure updater, never a setter that calls another.
- **File tree.** Use explicit kebab-case role names and one naming scheme. Prefer one substantive file to near-empty fragments; colocate `<name>.test.ts`; no barrels.
- **Package surface.** Declare exports for imported subpaths and import aliases for internal paths. Extend the shared lint preset with generated ignores only; add no package rule list or separate typecheck script.
- **Generated code.** A generator emits code that follows these rules as closely as it can; lint ignores its output.

## React

- **Atoms.** Data, shared state and every Effect a component needs live in atoms; a component reads them with hooks and never runs an Effect. A task that changes a React Query hook, a fetching Effect or an Effect runner in React code moves it to an atom. Declare atoms at module level or in `Atom.family`, never during render. Import `Atom` and `AsyncResult` from `effect/reactivity` and the hooks from `@effect/atom-react`. Supply services through `Atom.runtime(layer)` and build every read and write with that runtime's `atom` and `fn`. Tie each write to the reads it changes with reactivity keys; only a runtime's `fn` honors them.
- **Outcomes.** Read data with `useAtomSuspense`. The route or section that owns a screen wraps it in one `Suspense` boundary and one error boundary with a retry. Components never branch on loading or failure, and never turn a failure into an empty value. Take a write's pending and failure state from its atom's result. A reversible write updates the screen at once through `Atom.optimistic` and `Atom.optimisticFn`.
- **Ownership.** A component that owns atoms, writes or a lifetime gets its own file; a small presentational helper stays beside its one user. Reset an editable draft through a `key` on its identity, never a `useEffect` that copies props.
- **Pure render.** Derive display values during render, and never mutate them or run an RPC, write or subscription there. Event handlers own user actions; `useEffect` synchronizes only external systems.
- **State identity.** Keep one owner per value, stable domain keys for list items and deliberate reset boundaries. Fix an observed rerender by deriving the value in the existing atom graph; add no manual memoization or compiler escape directives.

```tsx
const appsRuntime = Atom.runtime(DualApps.layer)
const appAtom = Atom.family((id: AppId) => pipe(appsRuntime.atom(loadApp(id)), Atom.withReactivity(['apps'])))
const saveAppAtom = appsRuntime.fn((draft: AppDraft) => saveApp(draft), {reactivityKeys: ['apps']})
function AppFrame(props: {appId: AppId}) {
	return <Frame app={useAtomSuspense(appAtom(props.appId)).value} />
}
```

## Lint forms

Lint rejects the right column and has no autofix for it. Write the left column from the start.

| Write                                                                                              | Never                                                                        | Rule                                                                                     |
| -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| An early `return`, `Boolean.match(x, {onFalse, onTrue})`, `Option.match` or a lookup record        | `a ? b : c`, in JSX too                                                      | `no-ternary`                                                                             |
| `options?.root ?? '.'`                                                                             | `root !== undefined ? root : '.'`                                            | `no-nullish-ternary`, `prefer-nullish-coalescing`                                        |
| `pipe(Match.value(event), Match.tag('Text', text), Match.exhaustive)`                              | `switch`                                                                     | `no-switch-statement`                                                                    |
| `selected === true` on a value that can be `undefined`                                             | `if (selected)` on an optional                                               | `strict-boolean-expressions`                                                             |
| `if (!ready) return` then the main path                                                            | `if (!a) {...} else {...}`, `else` after `return`, `continue`                | `no-negated-condition`, `no-else-return`, `no-continue`                                  |
| At most 3 nested blocks, 6 nested callbacks and 3 nested `pipe` calls                              | Deeper nesting                                                               | `max-depth`, `max-nested-callbacks`, `no-deep-pipe`                                      |
| `pipe(value, f, g)`                                                                                | `value.pipe(f, g)`                                                           | `no-restricted-properties`                                                               |
| `const total = Array.reduce(values, 0, Number.sum)`                                                | `let` with a loop                                                            | `no-let`                                                                                 |
| `Array.join(parts, ', ')`, `Array.map(items, f)`, `String.split(text, ',')`, `Record.keys(record)` | `parts.join(', ')`, `items.map(f)`, `text.split(',')`, `Object.keys(record)` | `no-native-method-call`, `no-restricted-globals`; the `Path` service's `path.join` stays |
| `Predicate.isString(v)`, `Predicate.hasProperty(node, 'tag')`, `Predicate.isNotNullish(v)`         | `typeof`, `'tag' in node`, `v !== null && v !== undefined`                   | `no-typeof`, `no-in-operator`, `no-double-nullish-check`                                 |
| `Array.isReadonlyArrayEmpty(items)`, `String.isNonEmpty(text)`                                     | `items.length === 0`, `text.length > 0`                                      | `no-native-emptiness-check`                                                              |
| `Array.ensure(value)`                                                                              | `Array.isArray(value) ? value : [value]`                                     | `no-array-wrap-ternary`                                                                  |
| `Option.map(option, f)`, `Option.match`, `Option.getOrElse`                                        | `option.value`                                                               | `no-option-value-access`                                                                 |
| `undefined`, `Option.getOrUndefined`                                                               | `null`, `Option.getOrNull`, except for an outside contract                   | `unicorn/no-null`, `no-restricted-properties`                                            |
| `Number.parse(text)`, `Number.max`, `HashMap`, `HashSet`, `DateTime`                               | `parseInt`, `Math.max`, `Map`, `Set`, `Date`                                 | `no-restricted-globals`, `no-restricted-types`                                           |
| `Clock`, `Config`, `Console`, `Random`, `Effect.sleep`, `HttpClient`                               | `Date.now()`, `process.env`, `console`, `setTimeout`, `fetch`                | `effecttsgo/global-*`, `effecttsgo/process-env`                                          |
| `function name() {}` for a named function; an arrow only in place                                  | `const name = () => {}`                                                      | `func-style`                                                                             |
| `server => ({...server, warmup})`, `for (const schema of schemas)`, `pair => pair[0]`              | `({host, port}) =>`, `for (const {name} of schemas)`                         | `no-destructured-parameter`; labeled tuples, React state and refs can destructure        |
| `Array.sort(entries, Order.mapInput(Order.Number, (entry: Entry) => entry.tokens))`                | `entries.sort((left, right) => left.tokens - right.tokens)`                  | `no-native-method-call`; a third-party object's own method stays                         |
| The source value where it is used                                                                  | A one-line wrapper, alias or argument-free constant function                 | `no-trivial-indirection`, `no-constant-function`                                         |
| `import {Schema} from 'effect'`                                                                    | `import {Schema as S} from 'effect'`                                         | `no-renamed-import`                                                                      |
| Properties built with `Effect.fn` or `Effect.fnUntraced`                                           | `fetch: url => Effect.tryPromise(...)` as a property arrow                   | `no-effect-property-arrow`                                                               |
| Inferred return and variable types, `satisfies`, `Array.empty<T>()`                                | `function f(): T`, `const items: T[] = []`                                   | `no-return-type`, `no-redundant-variable-annotation`                                     |
| `satisfies T`, `as const`                                                                          | `as T`, `any`, `value!`                                                      | `consistent-type-assertions`, `no-explicit-any`, `no-non-null-assertion`                 |
| `Ref.make(0)`, `useState(false)`, `useRef<HTMLDivElement>(null)`                                   | `Ref.make<number>(0)`, `useRef<HTMLDivElement \| null>(null)`                | `no-redundant-state-type`, `no-redundant-use-ref-null-type`                              |
| `type X = {...}`, `T[]`, an optional property                                                      | `interface X`, `Array<T>`, `Promise<T>`, `x: T \| undefined`                 | `consistent-type-definitions`, `no-restricted-types`                                     |
| `return yield* NotFound.make({...})`                                                               | `yield* Effect.fail(NotFound.make({...}))`                                   | `effecttsgo/unnecessary-fail-yieldable-error`                                            |
| `Schema.decodeEffect(S)(typed)`, `Schema.fromJsonString(S)` for JSON text                          | `Schema.decodeUnknownEffect` on typed input, `JSON.parse`                    | `effecttsgo/prefer-typed-schema-decoder`, `prefer-schema-over-json`                      |
| The Schema operation inline at its use                                                             | `const decode = Schema.decodeEffect(S)` stored for later                     | `no-stored-schema-operation`                                                             |
| `Schema.Struct`, `Schema.TaggedError`, `Schema.NonEmptyString`                                     | `Schema.Class`, `Data.TaggedError`, `Error`, a rebuilt refinement            | `no-restricted-properties`, `no-reinvented-schema`                                       |
| The failure mapped to the service's error                                                          | `Effect.ignore`, `Effect.orDie` outside tests                                | `no-discarded-failure`                                                                   |
| `NodeRuntime.runMain(program)`; atoms in React                                                     | `Effect.runPromise`, `ManagedRuntime.make`                                   | `no-restricted-properties`                                                               |
| `import {useState} from 'react'`; `const [open, setOpen] = useState(false)`                        | `React.useState`, `const state = useState(false)`                            | `no-restricted-properties`, `no-undestructured-use-state`                                |
| React Compiler memoization, a `ref` prop                                                           | `useCallback`, `useMemo`, `memo`, `forwardRef`                               | `no-restricted-imports`                                                                  |
| The UI package's primitive                                                                         | A styled native `<button>` or `<input>`                                      | `no-native-control`                                                                      |
| `assert` from `@effect/vitest`, the failure's identity                                             | `expect`, `vi`, an assertion on message wording                              | `no-restricted-imports`, `no-error-message-assertion`                                    |
| One comment line for an outside constraint                                                         | A multiline comment                                                          | `no-multiline-comment`                                                                   |
| Object keys in ascending order; a blank line starts a new group                                    | Unsorted keys, a `sort-keys` disable                                         | `sort-keys`, `no-unexplained-disable`                                                    |

These forms satisfy every rule involved, where the obvious fix trades one diagnostic for another:

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
