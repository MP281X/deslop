---
name: engineering
description: "Use before writing or changing code, tests, scripts or configuration, before choosing how to build a feature, before a repository's fix, check, lint or test command, and before proving or testing behavior."
---

# Engineering

Standards for known things. The repository's `AGENTS.md` and the files it links win over this skill; lint owns every mechanical form, and this skill holds what lint cannot see. A cleanup request applies every rule to every line of the touched files; scratch code follows none.

**YAGNI.** What breaks for the user without it? Nothing: delete it. Today's request only; no planning for the future.

**Reader-first.** People review the PR body, the proof and a scan of the diff: idiomatic, effectful code that reads in place, where editing one part cannot break another.

## Loop

**Verify once.** At the root after the whole change and after each round of fixes, never per edit or package: the repository's fix, check and test commands chained bare. Read the failures from that run's whole output, never from a rerun with another filter; the first error in each file first.

```bash
<fix> && <check> && <test>
# bad: each step exits with tail's code, so test runs after a failed check
<fix> 2>&1 | tail -5 && <check> 2>&1 | tail -20 && <test> 2>&1 | tail -20
```

**Root cause.** Fix the class, not the instance: search every sibling of the failing form. After two failed fixes, write down the premise they share and test it before a third. A diagnostic on code the rules allow is a rule bug: fix the rule with a rejected and an accepted case.

**Disables** need an unavoidable outside contract and a `--` reason naming it; never for ordering or file configuration. A package extends the shared preset with generated ignores only.

## Design

**KISS.** Start from a real caller; trace one success and its strongest failure. The most direct code: extend the canonical example, else a function or an existing service method; a new service only for a distinct capability or lifetime.

**Scope discipline.** Fix reachable bugs inside the request; everything else is a proposal for the user.

**Don't reinvent the wheel.** Before a hand-written type, guard, table, wrapper, traversal or dependency, list the owning module's exports per explore: `Schema.TaggedUnion` replaces a matcher, `Array.dedupe` a `HashSet` round trip, `FileSystem` has glob.

**Rule of three.** Identical logic twice is one function in its owner's `lib/utils`; similar code stays apart; a shared function never branches on its caller.

**No speculative generality.** Each function, parameter, option, export, Layer or config value has a caller that varies it; explicit variants over boolean combinations, registries or factories.

**Single source of truth.** Derive from the owner; never mirror server state, request state or caches in another store. One write boundary per persisted value, one schema per domain enum, the full identity in a cache key.

**Parse, don't validate.** Decode once at the boundary with Effect Schema; never re-check what types guarantee. SDK input stays `unknown` until decoded.

**Fail loudly.** Errors flow through the channel with their cause, never as empty success; no catch, retry or fallback without a contract that needs it.

**Request lifetime.** Finite work stays in its request; background ownership only when work outlives its caller.

**Dependency inversion.** Domain code never imports transport types; domain schemas carry no HTTP status.

**Whole values.** Pass whole values; project fields only to withhold one, such as a bearer token.

**No backwards compatibility.** Rename a shape and every caller together. Persisted production data is the exception: a migration converts it and the code reads only the new shape.

**Characterization.** A refactor keeps observable output at every consumer: capture it through the real interface before, compare after.

**Dependencies.** A new one is `latest`, pinned only where a consumer requires it; extend it through its public API, never a patch.

**Measure performance.** Only when the request needs it: locate the cost with a profiler or trace, measure one real action before and after with run count and variation; a gap within the variation is no change.

**Dead code.** Delete every superseded file, export, type, branch, config, doc, test, dependency and empty directory in the same change.

## Patterns

**Canonical example.** Before a recurring shape (layout, list, form, state, dialog, service, route, error mapping, file, name), copy its canonical example: the Patterns row in the repository's standards, else the variant most consumers use, the newest on a tie; with none, explore's References.

**Taste.** The user's choices rule layout, files, boundaries, interfaces and names; add a Taste row with their words when they pick, reject or correct an uncovered choice.

**Pattern change.** A changed pattern updates its owner, migrates every consumer the row's search lists and deletes the old variant; a shared shape without a row gets one. Another repository or a published contract needs the user's approval first.

**Poka-yoke.** The same correction twice becomes impossible at the highest level that works: an owner component or type, then a lint rule naming the replacement.

## Effect

**Effect 4, not 3.** Names guessed from Effect 3 do not exist: `Order.flip` not `Order.reverse`, `Order.Number` not `Order.number`, `Schema.fromJsonString` not `Schema.parseJson`, `Schema.decodeUnknownEffect` not `Schema.decodeUnknown`. An unfamiliar name gets checked in the source per explore before use.

**Functions.** `Effect.fn('Service.method')` with arguments, `Effect.fnUntraced` internal, `Effect.gen` without arguments. RPC handlers and `Effect.fn` already trace: no span.

**Errors.** One `Schema.TaggedError` per service, mapped in `Effect.fn`'s pipeline argument at the adapter with secrets redacted; no SDK failure in a service signature.

**Services.** Inline a sole implementation in its Layer; `Context.Reference` for a default; build the shape with `Service.of`. One scope per lifetime, `Effect.acquireRelease`. A fallible pure value returns a `Result`.

## Types and Schema

**Derived types.** The library's type first, else `ReturnType<typeof fromSdk>` in the signature; never a type restating a schema.

**Optionality.** `Schema.optionalKey` for an absent field, `Schema.optional` only for an explicit `undefined`; reuse by spreading `.fields`.

**Smart constructor.** `X.make` throws: trusted values only; fallible input `X.makeEffect`, mapped to the domain error.

## React

**Atoms own state.** Data, shared state and every Effect live in atoms; components read them and never run an Effect. `Atom` and `AsyncResult` from `effect/reactivity`, hooks from `@effect/atom-react`; services via `Atom.runtime(layer)`, writes tied to reads by reactivity keys; no second state holder around a write that has an owner.

**Suspense boundary.** `useAtomSuspense`; the screen's owner wraps one `Suspense` and one error boundary with retry; components never branch on loading or failure; reversible writes use `Atom.optimistic`.

**Colocation.** A component stays in the file of its only user; one substantive file over fragments, named by role, never by kind or app.

```tsx
const appsRuntime = Atom.runtime(Apps.layer)
const appAtom = Atom.family((id: AppId) => pipe(appsRuntime.atom(loadApp(id)), Atom.withReactivity(['apps'])))
function AppFrame(props: {appId: AppId}) {
	return <Frame app={useAtomSuspense(appAtom(props.appId)).value} />
}
```

## Proof

**Spike.** Probe a question with inline code against the public interface or real data through the repository's script runner, such as `vp node -e '<script>'` or `bun -e '<script>'`; never a test file, seam, worktree or clone for one question.

**Definition of done.** Each changed behavior and consumer ran through its real interface on the final code: a screen in the browser, an API by request, a CLI by running it. A green suite does not replace that; zero collected tests or exit 0 alone prove nothing.

**Reproduce, then fix.** Shrink the reproduction until every input is needed; one hypothesis per probe; rerun the original scenario after.

**Test only owned logic.** Complex logic you own (parsing, state transitions, concurrency, scheduling, money, conversion): black box, expected values from the contract, one input per behavior. Never UI, libraries, what schemas guarantee, simple code, fixed bugs or implementation details; delete touched tests that break this.

**Effect tests.** `it.effect` virtual, `it.live` real, `it.layer` shares a block's context; `TestClock` from `effect/testing`; `Effect.flip` for a failure, `Effect.exit` for both; assert identity, not message.

**Real boundary.** Replace dependencies through Layers or parameters, never module mocks; an SDK, filesystem, HTTP or browser claim needs the real boundary; `FileSystem.layerNoop` is not storage, `RpcTest` bypasses serialization; a published tool is proved packed, not from source.

## Critique

Before done, reread the diff knowing only the request: **Smaller?** delete one part at a time and rerun the proof. **Existing?** the repository, a dependency or Effect already does it. **Consistent?** each shape matches its canonical example. **Proved?** each changed behavior and consumer ran through its real interface.

## Lint hazards

Write these shapes first: the tempting fix for each trips another rule or reshapes the code. Every other diagnostic is fixed in place as its message says.

- **Make illegal states unrepresentable.** `export type Kind = typeof Kind.Type` above `export const Kind = Schema.Literals([...])`, subset `Kind.pick`; a recursive schema hand-writes its type, `readonly` as `Schema.Array` decodes it, and annotates the `suspend` thunk; other shapes mutable, `readonly` only on service properties; rules: `no-type-from-value`, `schema-type-pair`, `no-reinvented-schema`, `effecttsgo/schema-union-of-literals`, `no-readonly-type-syntax`, `typescript/no-restricted-types`
- **Type the boundary.** Decode an `any` or `unknown` with the protocol schema; never `?.`, a cast or a disable on it; rules: `typescript/no-unsafe-*`, `no-unvalidated-json-decode`
- **One home per type.** The library's type or `ReturnType<typeof make>` in the signature, never a module alias; import from the defining module; rules: `no-floating-derived-type`, `no-barrel-module`
- **Reset by key.** Atoms at module level or `Atom.family`; `key` resets state when a prop changes, render derives a value, `useRef` holds lifecycle state, never a `useEffect` that sets state; rules: `no-component-atom-allocation`, `react-doctor/no-adjust-state-on-prop-change`, `react-doctor/no-derived-state`, `react/set-state-in-effect`, `no-fake-ref-state`, `no-undestructured-use-state`

**Errors are values.** `preserve-error-cause`, `no-empty-recovery`, `no-discarded-failure`, `explicit-effect-concurrency`, `effecttsgo/effect-fn-opportunity`, `effecttsgo/strict-effect-provide`

```ts
export const load = Effect.fn('Notes.load')(
	function* (path: string) {
		const fs = yield* FileSystem.FileSystem
		yield* pipe(fs.remove(`${path}.lock`), Effect.ignore({log: 'Warn', message: 'Lock not removed'}))
		return yield* fs.readFileString(path)
	},
	Effect.mapError(cause => NotesError.make({cause, message: 'Cannot read the note'}))
)
export const loadAll = Effect.fn('Notes.loadAll')(function* (paths: string[]) {
	return yield* Effect.forEach(paths, load, {concurrency: 'unbounded'})
})
// not: Effect.catch(() => Effect.void), Effect.orDie, mapError(() => X.make({message})), Effect.provide inside a service
```

**Flat code.** `no-ternary`, `no-continue`, `no-let`, `max-nested-callbacks`, `no-deep-pipe`, `no-single-use-value`, `no-property-alias`, `no-trivial-indirection`, `no-return-type`, `func-style`

```ts
function label(entry: Entry) {
	return Boolean.match(entry.done, {onFalse: () => 'Running', onTrue: () => 'Done'})
}
export function summarize(entries: Entry[]) {
	return {
		labels: pipe(
			entries,
			Array.filter(entry => entry.open),
			Array.map(label)
		),
		total: Array.reduce(entries, 0, (sum, entry) => sum + entry.tokens)
	} satisfies Summary
}
// not: a ? b : c, continue, let total, const open = entries.filter(…), const label = (entry) => …, summarize(): Summary
```
