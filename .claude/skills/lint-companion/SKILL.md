---
name: lint-companion
description: "Load before the first run of the repository's fix, check or test in a task, and when a diagnostic survives a fix."
---

# Lint companion

Each diagnostic names a form; this skill picks the fix that every other check also accepts, so the loop ends in a few runs with no disables and no workarounds.

## Loop

1. Run `AGENTS.md`'s fix, check and test from the root, bare: piping through `rg` or `head` hides the next error and the exit status.
2. Read every diagnostic before editing. Group them by file and cause; one owner fix often clears several.
3. Leave what `fix` rewrites to `fix`, edit the rest as one batch, rerun.
4. A diagnostic that survives a second spelling means the owner is wrong: change the shape, per the table, not the spelling.

## Fix the owner

| Diagnostics about                                                                                               | Fix                                                                                                                                                        | Workaround they reject                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `any`/`unknown` values (`no-explicit-any`, `no-unvalidated-json-decode`)                                        | Decode once with the protocol's Schema where the dependency hands the value over                                                                           | Casts, `Schema.Unknown`, checking the same value again downstream                            |
| `unknown` failures or requirements (`anyUnknownInErrorContext`)                                                 | Map the failure into the owner's tagged error where it enters; give a requirement its service type                                                         | `Effect.orDie` to drop the type, a cast on the Effect                                        |
| Promises (`Promise`, `asyncFunction`, `promiseInEffectSuccess`, `no-fallible-promise`)                          | Decide who observes the rejection: `Effect.tryPromise` with a tagged error in the SDK's adapter; plain values stay plain                                   | `Effect.promise` around a call that can reject, `runPromise` inside an Effect                |
| Absence (`no-null`, `undefined` in `no-restricted-types`, `no-option-value-access`)                             | `Option` where absence is a value, an optional property or parameter, `Option.match` to read it                                                            | `T \| undefined` spelled out, `.value` after `isSome`, a `boolean` standing in for `void`    |
| Mutation and branching (`no-let`, `no-param-reassign`, `no-accumulating-copy`, `no-ternary`)                    | An expression, an early-return `if`, `Option.match` or `Match`; a `MutableList` collected then consumed once                                               | The `let` moved into an object or a ref, a copying accumulator, a nested ternary turned call |
| Services and layers (`serviceNotAsClass`, `leakingRequirements`, `missingEffectContext`, `strictEffectProvide`) | The Layer and public helpers on the service class; a dependency yielded once in the Layer's constructor; Layers provided at the entry point                | A Layer exported beside the class, `Effect.provide` in the middle of a pipeline              |
| React state (`no-derived-state`, `no-adjust-state-on-prop-change`, `exhaustive-deps`)                           | Derive display values during render, reset a subtree with `key`, keep server state in atoms with Suspense and an error boundary at the screen that owns it | An effect copying props into state, a dependency left out of the array                       |
| Unused code (`noUnusedLocals`, dead-code reports)                                                               | Delete it; an unused export of a locally used implementation drops only `export`; a published API keeps outside consumers                                  | `_` prefixes, a fake use, an extra export, a test-only import as proof of use                |

```ts
// rejected: the ternary removed by widening the prop, the void by a boolean nobody reads
details: (string | undefined)[]
Deferred.make<boolean>()
// accepted: the caller builds the value the contract already takes
details={Array.filter([job.company, job.note], Predicate.isNotUndefined)}
Deferred.make<void>()
```

Every rewrite keeps evaluation order, receiver binding (`sdk.send` stays inside its adapter), resource lifetime and failure behavior.

## Never

- **Silence.** No disable comment, `@ts-expect-error` or Effect diagnostic directive unless the rule's message or its package's README names that exception, and then with `-- <reason>`; never widen an ignore, off or warning scope.
- **Shims.** No wrapper, stand-in type, wider type, prop spread or file split whose only job is to pass a check.
- **Policy.** A rule that blocks the intended form is a policy question: show the intended form and a genuinely invalid counterexample before changing the rule, and fix an owned rule's detection or message so its advice agrees with the other rules.
