---
name: lint-companion
description: "Choose the intended code shape before the first edit and resolve cross-rule traps without workarounds. Use before writing or changing code, tests or configuration, and before running the repository's fix, check or test."
---

# Lint companion

Lint owns mechanical forms and its messages name their fixes. This skill supplies the direction those messages cannot: which owner to change and which behavior to preserve, so the first lint pass does not require a rewrite.

## Target before code

- **Reference.** Read `CODING_STANDARDS.md` and the canonical examples `AGENTS.md` names before choosing a shape. Use the active preset for mechanical forms; a nearby file or an older guide is not precedent when the preset rejects it. Repository-specific judgement and documented outside contracts stay with their owners.
- **Owners first.** Choose the protocol schema, service/failure boundary and state owner the change needs before editing. Lint checks that design; passing lint is not the design.
- **Incremental adoption.** Warning and off scopes are migration debt, not permission to copy the old shape. New and rewritten code follows the target; new or split files start clean. Preserve unrelated legacy code and documented generated/public API exceptions rather than widening the refactor or its exemptions.

## Write these shapes first

- **Schema and value.** Export each half of a schema/type pair only when consumed. Recursive schemas need a hand-written type with the `readonly` arrays their decoder produces and an annotated `suspend` thunk; do not spread that exception to ordinary mutable data.
- **Boundary before access.** Decode an `any` or `unknown` with the protocol schema before property access, optional chaining, a cast or a disable. Put the schema with the boundary's owner, not a second shape at each caller.
- **Failure contract.** Decide how a finalizer's release can fail instead of mechanically converting it to a fallible Effect. Add tagged reasons only when a caller distinguishes them. Keep plain values plain when the host accepts them; an Effect runtime around a literal owns no work.
- **Service as namespace.** Put the service's Layer and public helpers on its named class. Replacing a self-reexport with a relative namespace import or renamed flat exports just moves the conflict to another rule. A published namespace API is an outside contract, not a reason to copy that shape internally.
- **Screen owner.** Build server-state atoms on the repository's application runtime, not a new runtime per component. Reset by `key`, derive display values during render, and let one screen owner supply Suspense and its error boundary rather than wrapping each helper.

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

Consume once after collection. Keep `MutableRef` for replacement or an observed intermediate value; it is not a wrapper to evade the mutation rule.

## Gate

Use `AGENTS.md`'s editing, finished-change and delivery commands for this checkout. A focused file pass does not check unchanged consumers of an exported type or replace the finished-change gate. Chain the required stages bare with `&&`; no pipe to `tail` that hides the failing exit status.

After the coherent change, run the required stages on stable source. Keep autofixes and their formatting; fix the first remaining error in each file, then rerun after the batch, not after every diagnostic.

## Repair the owner, not the spelling

- **Combined policy.** A correction that trips another check needs the intended shape, not another spelling: no wrapper, fake use, extra export, prop spread, wider type or file split solely to silence a diagnostic. Choose the domain predicate instead of wrapping truthiness in a constructor; prefer a direct branch to a combinator that only hides one. Preserve evaluation order, receiver binding and resource/failure behavior while simplifying.
- **Deletion.** An unused export does not make its locally used implementation dead. Test-only imports do not prove shipping use, and a published API is an outside consumer. Trace callers before removing behavior. Complexity needs simpler ownership or control flow, not wrappers that move the score.
- **Exemptions.** An inline disable names the real outside contract in its `--` reason. Do not add files or rules to warning/off/ignore lists to make implementation work pass. Measured adoption debt and generated-code exclusions are configuration policy, not an escape for new code.
- **Rule conflict.** If an allowed form is rejected or two rules reject each other's fix, demonstrate the rejected and preserved cases. Fix an owned rule; report an upstream conflict instead of contorting the application or weakening checks around it.
