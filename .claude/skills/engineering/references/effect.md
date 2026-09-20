# Effect Programs

## Operation Selection

| Intent                        | Operation                                          |
| ----------------------------- | -------------------------------------------------- |
| String or array length        | `String.length` / `Array.length`                   |
| Projection in a composition   | `Struct.get` / `Struct.pick` / `Struct.omit`       |
| Transform known fields        | `Struct.evolve`                                    |
| Possibly absent dynamic entry | `Record.get`, preserving its `Option`              |
| Plain immutable keyed values  | `HashMap` or `Record`                              |
| Reusable composition          | `flow`                                             |
| Immediate composition         | `pipe`                                             |
| Reusable pure predicate       | `Predicate.and` / `Predicate.or` / `Predicate.not` |
| Inline control or JSX gate    | JavaScript boolean operators                       |

```ts
const publicUser = pipe(user, Struct.omit(['password']))

const enabled = pipe(flags, Record.get(key))
```

Access a known field directly when no composition is needed: `user.name`. Use `Struct.get` when an accessor participates in a composition, such as `Array.map(users, Struct.get('name'))`.

A dynamic lookup returns `Option` because absence is part of its semantics.

Evaluate an effectful fact once within the operation that owns its validity and pass the result to dependent work. Do not reuse authorization or mutable state across a boundary where it can become stale.

## Program Shape

| Need                                                    | Form                                                    |
| ------------------------------------------------------- | ------------------------------------------------------- |
| Safe delegation with the same signature                 | Reuse the function value                                |
| Immediate or reusable straight-line composition         | `pipe` or `flow`                                        |
| Straight-line transformation or sequencing              | The matching Effect combinator in the pipeline          |
| Dependent sequencing or branching clearer as statements | `Effect.gen`                                            |
| Argument-taking generator                               | `Effect.fnUntraced`                                     |
| Intentional named tracing checkpoint                    | Named `Effect.fn` or `Effect.withSpan` around an Effect |

```ts
save: storage.save
```

```ts
save: Effect.fnUntraced(function* (input) {
	const current = yield* storage.read(input.id)
	if (current.value === input.value) return current
	return yield* storage.write(input)
})
```

Use a generator when dependent branching or several intermediate values would otherwise require nested callbacks or an artificial state bundle. A zero-input program is an Effect value, not an `Effect.fn` call.

Reuse a function value only when doing so preserves required arguments, laziness, tracing, receiver binding, and the callback signature. Keep a wrapper when it intentionally adapts any of those semantics. Keep reusable pure composition pure; `flow` does not make effectful operations pure.

## Tracing

Public service logic owns its named checkpoint. Direct delegation reuses existing tracing. A distinct costly or failure-prone stage may own one span; a pure transformation owns none. Trace finite stream work with `Stream.withSpan` only when no existing owner covers it. Adding observability must not change concurrency, ordering, or failure behavior.

## Traversal And Concurrency

Choose traversal from the required failure and ordering contract. Use `Effect.validate` when every ordinary typed failure must be accumulated; its error is a collection rather than the original single error. It does not provide rollback or guarantee completion after interruption or defects. Set concurrency from ordering, dependency, and resource requirements.

Use Effect's concurrency primitives directly. Add custom queues, workers, semaphores, or configurable limits only for a concrete ordering, resource, or contention requirement.
