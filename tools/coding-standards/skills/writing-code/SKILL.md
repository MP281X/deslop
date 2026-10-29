---
name: writing-code
description: "Load before the first edit to code, tests or configuration in a task, before running the repository's fix, check or test, and when a lint or type error persists after a fix."
---

# Writing code

Choose the target before writing, not a sequence of spellings that pass lint. Diagnostics own mechanical fixes; this skill owns the decisions that otherwise force a rewrite.

## Target before code

- **Reference.** Read `CODING_STANDARDS.md` and the canonical examples `AGENTS.md` names; a nearby file is not precedent when the preset rejects it.
- **Owners.** Trace the input to its schema, service/failure boundary and state owner, and reuse that path; add an owner only for a capability it lacks.
- **Boundary before access.** Decode dependency-provided `any` or `unknown` once, at its protocol owner.
- **Async contract.** Decide who observes an SDK Promise and its rejection, which failures are expected, which are defects and what finalizers release, before choosing the Effect constructor. Plain values stay plain when the host accepts them.
- **Service as namespace.** The service's Layer and public helpers live on its class.
- **Screen owner.** Server-state atoms use the application's runtime; reset by `key`, derive display values during render, and keep Suspense and error boundaries at the screen that owns the state.
- **Local collectors.** `MutableList` collected then consumed once; `MutableRef` only for replacement or an observed intermediate value.

```ts
export class Notes extends Context.Service<
	Notes,
	{readonly load: (path: string) => Effect.Effect<string, NotesError>}
>()('@app/Notes') {
	static readonly layer = Layer.effect(this, make)
}
```

## Verify

Apply the whole change, then run `AGENTS.md`'s fix, check and test from the root, bare, until they pass; piping through `rg` or `head` hides the next error and the exit status. Repair the first error in each file with the checks its fix touches, as one batch.

## Repair the owner, not the spelling

No wrapper, fake use, extra export, prop spread, wider type, stand-in type or file split solely to silence a diagnostic. A second failed spelling means the owner is wrong.

```tsx
// rejected: the ternary removed by widening the prop, the void by a boolean nobody reads
details: (string | undefined)[]
Deferred.make<boolean>()
// accepted: the caller builds the value the contract already takes
details={Array.filter([job.company, job.note], Predicate.isNotUndefined)}
Deferred.make<void>()
```

- **Deletion.** An unused export does not make its locally used implementation dead; test-only imports do not prove shipping use, and a published API has outside consumers.
- **Scopes.** Never enlarge warning, off or ignore scopes to pass.
- **Rule conflict.** Show the intended form and a genuinely invalid counterexample before changing policy; fix an owned rule's detection or message so its advice converges with the other rules.
