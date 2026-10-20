---
name: lint-companion
description: "Companion to the @deslop/coding-standards linter: the shapes to write first so lint passes on the first Verify. Use before writing or changing code, tests or configuration, and before running the repository's fix, check or test."
---

# Lint companion

Lint owns every mechanical form and its message names the fix; this skill holds only what makes those fixes converge. The repository's `AGENTS.md` and `CODING_STANDARDS.md` win over it.

## Verify once

The repository's static gate and tests, chained bare at the root, after the whole change and after each round of fixes; read failures from that run, the first error in each file first.

```bash
<static gate> && <test>
# not: <gate> 2>&1 | tail -5 && <test>, where test runs after a failed gate
```

## Write these shapes first

The tempting fix for each trips another rule or reshapes the code; every other diagnostic is fixed in place as its message says.

- **Make illegal states unrepresentable.** `export type Kind = typeof Kind.Type` above `export const Kind = Schema.Literals([...])`, subset `Kind.pick`; a recursive schema hand-writes its type, `readonly` as `Schema.Array` decodes it, and annotates the `suspend` thunk; other shapes mutable, `readonly` only on service properties.
- **Type the boundary.** Decode an `any` or `unknown` with the protocol schema, before any `?.`, cast or disable could touch it.
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
// not: Effect.catch(() => Effect.void), Effect.orDie, mapError(() => X.make({message})), Effect.provide inside a service
```

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

## Rules

- **Rule bug.** A diagnostic on code the rules allow, or two rules that reject each other's fix, is a rule bug: fix the rule with a rejected and an accepted case from the real code.
- **Same correction twice** becomes impossible at the highest level that works: an owner component or type, then a lint rule whose message names the one fix.
- **Disables** name an outside contract in their `--` reason.
