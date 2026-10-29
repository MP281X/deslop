---
name: writing-code
description: "Load before the first edit to code, tests or configuration in a task, before running the repository's fix, check or test, and when a lint or type error persists after a fix."
---

# Writing code

Choose the target before writing, not a sequence of spellings that pass lint. Diagnostics own mechanical fixes; this skill owns the cross-rule decisions that otherwise force a rewrite.

## Target before code

- **Reference.** Read `CODING_STANDARDS.md` and the canonical examples `AGENTS.md` names before choosing a shape. A nearby file is not precedent when the preset rejects it.
- **Owners first.** Trace the input to its schema, service/failure boundary and state owner before editing. Reuse that path; add an owner only for a capability it lacks. Passing lint does not establish that the boundary or abstraction belongs there.

## Write these shapes first

- **Boundary before access.** Decode dependency-provided `any` or `unknown` at its protocol owner before accessing fields; callers never each invent a second schema for the same input.
- **Async contract.** Trace who observes an SDK Promise and its rejection; an Effect-heavy caller does not make a discarded native Promise safe. Keep receiver-dependent calls inside their adapter. Decide expected failures, defects and finalizer-release policy before choosing the Effect constructor; add tagged reasons only when a caller distinguishes them. Plain values stay plain when the host accepts them.
- **Service as namespace.** Put the service's Layer and public helpers on its named class.
- **Screen owner.** Use the application's runtime for server-state atoms, not a component runtime or a second provider. Reset by `key`, derive display values during render, and keep Suspense/error boundaries at the screen that owns the state.
- **Local collectors.** Choose the accumulator before the loop: `MutableList` collected then consumed once; `MutableRef` only for replacement or an observed intermediate value.

```ts
export class Notes extends Context.Service<
	Notes,
	{readonly load: (path: string) => Effect.Effect<string, NotesError>}
>()('@app/Notes') {
	static readonly layer = Layer.effect(this, make)
}
// Consumers: yield* Notes; Notes.layer.
```

## Verify

Apply the whole change, then loop `AGENTS.md`'s fix, check and test from the root until they pass, run bare so every diagnostic and the real exit status show:

```bash
<fix> && <check> && <test>
# not: <check> 2>&1 | rg error | head -20, which hides the next error and the exit status
```

Read the first remaining error in each file together with the checks its fix touches; repair that coherent batch before rerunning. A second spelling failure is a signal to revisit the owner, not add another layer.

## Repair the owner, not the spelling

- **Combined policy.** No wrapper, fake use, extra export, prop spread, wider type or file split solely to silence a diagnostic. Judge the result against all checks together: preserve evaluation order, receiver binding, resource lifetime and failure behavior.
- **Deletion.** An unused export does not make its locally used implementation dead; test-only imports do not prove shipping use, and a published API is an outside consumer.
- **Scopes.** Never enlarge warning/off/ignore scopes to make the implementation pass; fix placement or ownership instead.
- **Rule conflict.** Show the intended form and a genuinely invalid counterexample before changing policy. Fix an owned rule's detection or message so its advice converges with the other rules; report an upstream conflict rather than contorting the application.
