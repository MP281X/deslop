---
name: lint-companion
description: "Companion to the @deslop/coding-standards linter: the shapes to write first so lint passes on the first Verify. Use before writing or changing code, tests or configuration, and before running the repository's fix, check or test."
---

# Lint companion

Lint owns every mechanical form and its message names the fix; this skill holds only what makes those fixes converge. The repository's `AGENTS.md` and `CODING_STANDARDS.md` win over it.

## Verify once

Run the repository's static gate and tests, chained bare at the root, on a stable state after the whole change and each round of fixes. Preserve the failing step's exit status and diagnostics; fix from that run, the first error in each file first. Keep autofixes for the next run, never discard them to make later checks pass.

```bash
<static gate> && <test>
# not: <gate> 2>&1 | tail -5 && <test>, where test runs after a failed gate
```

## Write these shapes first

The tempting fix for each trips another rule or reshapes the code; every other diagnostic is fixed in place as its message says.

- **Make illegal states unrepresentable.** `type Kind = typeof Kind.Type` immediately above `const Kind = Schema.Literals([...])`, subset `Kind.pick`; export each half only when consumers use it. Recursive schemas hand-write their type, `readonly` as `Schema.Array` decodes it, and annotate the `suspend` thunk; other shapes mutable, `readonly` only on service properties.
- **Type the boundary.** Decode an `any` or `unknown` with the protocol schema, before any `?.`, cast or disable could touch it.
- **Adapt the failure contract, not the return syntax.** A rejecting Promise takes `Effect.tryPromise`; `Effect.promise` means rejection is a defect, not a typed failure. Finalizers need an explicit release-failure policy rather than a mechanical rewrite to a fallible release. Keep plain values plain when the host already accepts them; an Effect runtime around a literal owns no work.
- **Separate reasons from wording.** Retry and recovery consume a stable tagged error or literal reason; messages remain display copy. Add only distinctions a caller actually uses, and preserve causes rather than replacing them with their messages.
- **One home per type.** The library's type or `ReturnType<typeof make>` in the signature rather than a module alias; import from the defining module.
- **Reset by key.** Atoms at module level or in an `Atom.family` keyed by their input, built on the runtime the repository's canonical example or `CODING_STANDARDS.md` names; `key` resets state when a prop changes, render derives a value, `useRef` holds lifecycle state, and effects never set state. Components read atoms and never run an Effect; the screen's owner wraps one `Suspense` and one error boundary.

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
// not: Effect.catch(() => Effect.void), Effect.orDie, mapError(cause => X.make({message})), Effect.provide inside a service
```

```ts
function label(entry: Entry) {
	if (entry.done) return 'Done'
	return 'Running'
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

### Local collectors

```diff
-const items = MutableRef.make(Array.empty<Entry>())
-MutableRef.update(items, Array.append(entry))
+const items = MutableList.make<Entry>()
+MutableList.append(items, entry)
 // Consume once, after collection.
+const entries = MutableList.toArray(items)
```

- `MutableList`: local, append-only; no observed intermediate array identity.
- `MutableRef`: replacement or observed current value, not a blanket collection wrapper.

## Rules

- **Rule bug.** A diagnostic on code the rules allow, or two rules that reject each other's fix, is a rule bug: fix the rule with a rejected and an accepted case from the real code.
- **Same correction twice** becomes impossible at the highest level that works: an owner component or type, then a lint rule whose message names the one fix.
- **Disables** name an outside contract in their `--` reason.

## Repository analysis

Keep the full Fallow scan and a production-reachability scan: tests are roots in the full scan, so a test import does not prove shipping use. Trace a finding before removal; a helper still called locally needs its export removed, not its implementation deleted, and unique behavior stays covered through the production seam. Published APIs and framework entrypoints are outside contracts, not blanket tooling exceptions.

Duplication stays advisory: matching syntax is not proof of shared ownership. Complexity failures need simpler ownership or control flow, not wrappers that relocate the score; retain an exact function ceiling only when the current shape is clearer. Architecture zones follow canonical schema and helper names before server implementation defaults, not an enumeration of every existing service.
