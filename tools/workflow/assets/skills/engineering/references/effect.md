# Effect Programs

## Operation Selection

Search the relevant Effect module before using a native prototype, global, or custom helper. Prefer the operation whose type and semantics express the intent, even when it is longer than native syntax. Keep native integration at a concrete interoperability boundary.

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

Shape transformations must be required by the current contract. A convenient Effect operation does not justify changing the shape. A dynamic lookup returns `Option` because absence is part of its semantics.

Evaluate an effectful fact once within the operation that owns its validity and pass the result to dependent work. Do not reuse authorization or mutable state across a boundary where it can become stale.

## Program Shape

Use the shortest form that preserves semantics and lets TypeScript infer the implementation. Start with `pipe` for immediate straight-line composition or `flow` when the composition is reused.

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

Use a generator when dependent branching or several intermediate values would otherwise require nested callbacks or an artificial state bundle. The number of asynchronous steps alone does not justify one. A zero-input program is an Effect value, not an `Effect.fn` call. Do not wrap direct delegation in a generator, an immediately invoked function, or a forwarding callback.

Reuse a function value only when doing so preserves required arguments, laziness, tracing, receiver binding, and the callback signature. Keep a wrapper when it intentionally adapts any of those semantics. Do not introduce an alias or forwarding helper merely to change argument order, rename an operation, hide a default, or erase part of its signature. Keep reusable pure composition pure; `flow` does not make effectful operations pure.

## Capabilities And Ownership

Represent filesystem, HTTP, configuration, time, randomness, logging, processes, and other external capabilities with Effect services. Preserve requirements through composition and assemble Layers at their owner. Construct Effects inside Effect programs and execute them only through the owning runtime.

Keep failures typed and propagate dependency failures to the established error boundary and formatting owner. Do not catch and rethrow, repackage, retry, fall back, supply a default, hide an error, or convert defects into domain failures without an agreed recovery policy. Scoped cleanup must release its resource while preserving the original failure.

## Tracing

Public service logic owns its named checkpoint. Direct delegation reuses existing tracing. A distinct costly or failure-prone stage may own one span; a pure transformation owns none. Trace finite stream work with `Stream.withSpan` only when no existing owner covers it. Adding observability must not change concurrency, ordering, or failure behavior.

## Traversal And Concurrency

Choose traversal from the required failure and ordering contract. Use `Effect.validate` when every ordinary typed failure must be accumulated; its error is a collection rather than the original single error. It does not provide rollback or guarantee completion after interruption or defects. Set concurrency from ordering, dependency, and resource requirements.

Use Effect's concurrency primitives directly. Add custom queues, workers, semaphores, or configurable limits only for a concrete ordering, resource, or contention requirement.
