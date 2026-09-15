# Effect Programs

## Operation Selection

Search the relevant Effect module before using a native prototype, global, or custom helper. Prefer the operation whose type and semantics express the intent, even when it is longer than native syntax. Keep native integration at a concrete interoperability boundary.

| Intent                        | Operation                                          |
| ----------------------------- | -------------------------------------------------- |
| String or array length        | `String.length` / `Array.length`                   |
| Known field or projection     | `Struct.get` / `Struct.pick` / `Struct.omit`       |
| Transform known fields        | `Struct.evolve`                                    |
| Possibly absent dynamic entry | `Record.get`, preserving its `Option`              |
| Plain immutable keyed values  | `HashMap` or `Record`                              |
| Reusable composition          | `flow`                                             |
| Immediate composition         | `pipe`                                             |
| Reusable pure predicate       | `Predicate.and` / `Predicate.or` / `Predicate.not` |
| Inline control or JSX gate    | JavaScript boolean operators                       |

```ts
const publicUser = pipe(user, Struct.omit(['password']))

const normalized = pipe(user, Struct.evolve({name: String.trim}))

const enabled = pipe(flags, Record.get(key))
```

Shape transformations must be required by the current contract. A convenient Effect operation does not justify changing the shape. A dynamic lookup returns `Option` because absence is part of its semantics.

Evaluate an effectful fact once within the operation that owns its validity and pass the result to dependent work. Do not reuse authorization or mutable state across a boundary where it can become stale.

## Program Shape

| Shape                                    | Form                                           |
| ---------------------------------------- | ---------------------------------------------- |
| Direct delegation                        | Arrow; reuse delegated tracing                 |
| Argument-taking branching or sequencing  | `Effect.fnUntraced`                            |
| Callback constructing a sequenced Effect | `Effect.fnUntraced`                            |
| Public service logic owning a checkpoint | Named `Effect.fn`                              |
| Zero-input branching or sequencing       | `Effect.gen`                                   |
| Zero-input checkpoint                    | Name-first `Effect.withSpan` around the Effect |

```ts
save: input => storage.save(input)
```

```ts
save: Effect.fnUntraced(function* (input) {
	const current = yield* storage.read(input.id)
	if (current.value === input.value) return current
	return yield* storage.write(input)
})
```

Do not wrap direct delegation in a generator. Do not introduce an alias or forwarding helper merely to change argument order, rename an operation, hide a default, or erase part of its signature. Keep reusable pure composition pure; `flow` does not make effectful operations pure.

## Capabilities And Ownership

Represent filesystem, HTTP, configuration, time, randomness, logging, processes, and other external capabilities with Effect services. Preserve requirements through composition and assemble Layers at their owner. Construct Effects inside Effect programs and execute them only through the owning runtime.

Keep failures typed. Preserve them until a layer owns a domain recovery. Do not catch and rethrow, erase an error, or convert defects into ordinary domain failures without an owned policy.

## Tracing

Public service logic owns its named checkpoint. Direct delegation reuses existing tracing. A distinct costly or failure-prone stage may own one span; a pure transformation owns none. Trace finite stream work with `Stream.withSpan` only when no existing owner covers it. Adding observability must not change concurrency, ordering, or failure behavior.

## Traversal And Concurrency

Choose traversal from the required failure and ordering contract. Use `Effect.validate` when every ordinary typed failure must be accumulated; its error is a collection rather than the original single error. It does not provide rollback or guarantee completion after interruption or defects. Set concurrency from ordering, dependency, and resource requirements.

## Source Lookup

Use [the source catalog](sources.md) when an API, type, lifetime, or runtime behavior is uncertain. Search the relevant package for the exported symbol, implementation, and maintained tests. Avoid copying a broad library inventory into project instructions.
