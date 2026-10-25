---
name: lint-companion
description: "Choose the intended code shape before the first edit and resolve cross-rule traps without workarounds. Use before writing or changing code, tests or configuration, and before running the repository's fix, check or test."
---

# Lint companion

Choose the target before writing, not a sequence of spellings that pass lint. Diagnostics own mechanical fixes; this skill owns the cross-rule decisions that otherwise force a rewrite.

## Target before code

- **Reference.** Read `CODING_STANDARDS.md` and the canonical examples `AGENTS.md` names before choosing a shape. Use the active preset for mechanical forms; a nearby file or an older guide is not precedent when the preset rejects it. Repository-specific judgement and documented outside contracts stay with their owners.
- **Owners first.** Trace the input to its schema, service/failure boundary and state owner before editing. Reuse that path; add an owner only for a capability it lacks. Passing lint does not establish that the boundary or abstraction belongs there.
- **Incremental adoption.** Warning and off scopes are migration debt, not permission to copy the old shape. New and rewritten code follows the target; new or split files start clean. Preserve unrelated legacy code and documented generated/public API exceptions rather than widening the refactor or its exemptions.

## Write these shapes first

- **Schema and value.** Define the boundary schema once and derive its ordinary type; export either half only when consumed. A recursive schema needs a hand-written type with the decoder's `readonly` arrays and an annotated `suspend` thunk, not a new convention for ordinary data.
- **Boundary before access.** Decode dependency-provided `any` or `unknown` at its protocol owner before accessing fields. Optional chaining, a cast or a wider type cannot validate it; callers should not each invent a second schema for the same input.
- **Async contract.** Trace who observes an SDK Promise and its rejection; an Effect-heavy caller does not make a discarded native Promise safe. Keep receiver-dependent calls inside their adapter. Decide expected failures, defects and finalizer-release policy before choosing the Effect constructor; add tagged reasons only when a caller distinguishes them. Plain values stay plain when the host accepts them.
- **Service as namespace.** Put the service's Layer and public helpers on its named class. Preserve published namespace contracts without copying that shape internally.
- **Screen owner.** Use the application's runtime for server-state atoms, not a component runtime or a second provider. Choose the reset and loading owner before wiring hooks: reset by `key`, derive display values during render, and keep Suspense/error boundaries at the screen that owns the state.

```ts
export class Notes extends Context.Service<
	Notes,
	{readonly load: (path: string) => Effect.Effect<string, NotesError>}
>()('@app/Notes') {
	static readonly layer = Layer.effect(this, make)
}
// Consumers: yield* Notes; Notes.layer.
// Not: a self-reexport, import * as Notes from './notes.ts', or layer as notesLayer.
```

### Local collectors

```diff
-const items = MutableRef.make(Array.empty<Entry>())
-MutableRef.update(items, Array.append(entry))
+const items = MutableList.make<Entry>()
+MutableList.append(items, entry)
+const entries = MutableList.toArray(items)
```

Choose the accumulator before the loop. Consume once after collection; keep `MutableRef` for replacement or an observed intermediate value, not as a mutation-rule workaround.

## Gate

Use `AGENTS.md`'s editing and finished-change commands for this checkout. A focused pass guides the edit but does not check unchanged consumers of an exported type. Chain the required stages bare with `&&`, preserving their exit status and diagnostics.

Keep autofixes and formatting. Read the first remaining error in each file together with the checks its fix touches; repair that coherent batch before rerunning. A second spelling failure is a signal to revisit the owner, not add another layer.

## Repair the owner, not the spelling

- **Combined policy.** No wrapper, fake use, extra export, prop spread, wider type or file split solely to silence a diagnostic. Choose the domain predicate instead of a truthiness constructor and a direct branch instead of a combinator that only hides one. Judge the result against all checks together: preserve evaluation order, receiver binding, resource lifetime and failure behavior, not merely the last diagnostic's suggested spelling.
- **Deletion.** An unused export does not make its locally used implementation dead. Test-only imports do not prove shipping use, and a published API is an outside consumer. Trace callers before removing behavior. Complexity needs simpler ownership or control flow, not wrappers that move the score.
- **Exemptions.** An inline disable names the real outside contract in its `--` reason. Never enlarge warning/off/ignore scopes to make the implementation pass; fix placement or ownership instead. A shared value belongs in the repository's shared-code location, not a server module with a boundary exception for its client.
- **Rule conflict.** Demonstrate the intended form and a genuinely invalid counterexample before changing policy. Fix an owned rule's detection or message so its advice converges with the other rules; report an upstream conflict rather than contorting the application or weakening checks around it.
