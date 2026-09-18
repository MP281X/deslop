---
name: engineering
description: 'Use for product-code architecture, implementation, coding style, testing, review, or to locate authoritative library source.'
---

Write code to these rules before static analysis. Apply the repository's project-engineering skill, where it provides one, for its concrete architecture and conventions.

## Boundary

Decode unsafe data once at the external boundary that admits it, normalize there only when the contract requires a canonical representation, then trust the result.

```ts
// bad — the boundary asserts unknown data, so the service compensates
const notesWithInternalValidation = {
	create: Effect.fnUntraced(function* (input: CreateNote) {
		const validInput = yield* Schema.decodeUnknownEffect(CreateNote)(input)
		return yield* repository.create(validInput)
	})
}
const input = JSON.parse(text) as CreateNote
return yield * notesWithInternalValidation.create(input)

// good — the boundary admits one decoded value
const input = yield * Schema.decodeEffect(Schema.fromJsonString(CreateNote))(text)
return yield * notes.create(input)
```

## Shape

Let one Schema and its inferred type own each public boundary shape. Infer implementation types; do not add parallel interfaces, needless annotations, casts, or internal revalidation.

```ts
// bad — a second shape and an assertion compete with the Schema
export const AiSkill = Schema.Struct({name: Schema.String, description: Schema.String})
export interface AiSkill {
	name: string
	description: string
}
const skill = raw as AiSkill

// good
export type AiSkill = typeof AiSkill.Type
export const AiSkill = Schema.Struct({name: Schema.String, description: Schema.String})
```

## Effect

Represent effectful application logic, dependencies, failures, sequencing, concurrency, resources, and external capabilities in Effect. Execute them through the owning runtime; keep pure transformations pure.

```ts
// bad — an untracked native effect escapes the Effect program
const load = async (path: string) => JSON.parse(await readFile(path, 'utf8'))

// good — requirements and failure stay in the Effect type
const load = Effect.fnUntraced(function* (path: string) {
	const fileSystem = yield* FileSystem.FileSystem
	const text = yield* fileSystem.readFileString(path)
	return yield* Schema.decodeEffect(Schema.fromJsonString(Config))(text)
})
```

## Capability

Use installed libraries and idiomatic Effect modules before writing custom logic. Inspect installed source, types, and maintained tests for the exact API and semantics.

```ts
// bad — custom lookup discards the library's absence type
const skill = skills.find(candidate => candidate.name === input.name)
if (skill === undefined) return fallback

// good — the module operation preserves absence as Option
const skill = Array.findFirst(skills, candidate => candidate.name === input.name)
```

## Failure

Fail fast through Effect's typed error channel to its established boundary and formatter. Recover, retry, or default only when that behavior is an approved product decision.

```ts
// bad — changes every dependency failure into a plausible value
const config = yield * loadConfig.pipe(Effect.catchAll(() => Effect.succeed(defaultConfig)))

// good — the dependency failure reaches the owning boundary unchanged
const config = yield * loadConfig
```

## Mutation

Do not mutate arguments, props, published service values, or returned data. Use owned Effect state for required changes without `readonly` syntax.

```ts
// bad — mutates an admitted value owned by the caller
input.visitors.push(visitor)

// good — the state owner publishes a new value
yield * SubscriptionRef.update(state, current => ({...current, visitors: Array.append(current.visitors, visitor)}))
```

## Expression

Prefer explicit, composable, locally readable code. Add a helper, Layer, or file only for genuine complexity or a shared rule needing one owner, never for naming or reuse alone.

```ts
// bad — a wrapper with one call site
function findSkill(skills: AiSkill[], name: string) {
	return Array.findFirst(skills, skill => skill.name === name)
}
const skill = findSkill(skills, input.name)

// good — inline this function at its only use site
const skill = Array.findFirst(skills, candidate => candidate.name === input.name)
```

```ts
// bad — a forwarding generator hides direct delegation
save: input =>
	Effect.gen(function* () {
		return yield* storage.save(input)
	})

// good
save: storage.save
```

## Ownership

Give each state value, validation, derived value, resource lifetime, service construction, and recovery policy one owner.

```ts
// bad — two writable copies can disagree
const [items, setItems] = useState(source.items)
const [visibleItems, setVisibleItems] = useState(items.filter(item => item.visible))

// good — source owns state; the consumer derives its view
const visibleItems = Array.filter(source.items, item => item.visible)
```

```ts
// bad — acquisition and cleanup have different owners
const socket = yield * openSocket
yield * Effect.addFinalizer(() => closeSocket(socket))

// good — one scope owns the complete resource lifetime
const socket = yield * Effect.acquireRelease(openSocket, closeSocket)
```

## Scope

Implement the smallest complete current behavior. Add no speculative behavior, adapter, compatibility path, configurability, or broad refactor. Remove superseded code only inside the approved affected behavior.

```ts
// bad — the requirement is one fixed retry, but the change invents a framework
interface RetryPolicy {
	attempts: number
	delay: Duration
	strategy: 'fixed' | 'exponential'
}
const retry = (policy: RetryPolicy) => Schedule.exponential(policy.delay)

// good — implement the required behavior directly
const retryOnce = Schedule.recurs(1)
```

```ts
// bad — preserves the replaced route for hypothetical callers
export const create = createV2
export const createLegacy = createV1

// good — one current implementation remains
export const create = createV2
```

## Tests

Test only app-owned decisions or logic whose plausible regression cost warrants durable protection. Exercise public inputs and results; do not test library behavior, type guarantees, or implementation details.

```ts
// bad — retests Schema's trim and non-empty semantics
it('trims titles', () => expect(Schema.decodeUnknownSync(Title)('  note  ')).toBe('note'))

// good — protects the app-owned conflict decision through its public result
it.effect('keeps the existing note when the revision is stale', () =>
	Effect.gen(function* () {
		const result = yield* notes.update({id, revision: 1, title: 'changed'}).pipe(Effect.exit)
		expect(result).toEqual(Exit.fail(new RevisionConflict({id})))
	})
)
```

## Evidence

Inspect affected code and direct dependencies before changing them. Examples demonstrate choices; installed source and types define library behavior.

```ts
// bad — guessed from memory for an unscoped constructor
const layer = Layer.scoped(Service, makeService(config))

// good — use the signature accepted by installed types and existing consumers
const layer = Layer.effect(Service, makeService(config))
```

Do not generalize from one call site when the behavior is owned by a service, Schema, Layer, or library contract. Read that owner first.

## References

| Need                                                             | Read                                      |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Effect operations, composition, tracing, errors, and concurrency | [Effect](references/effect.md)            |
| Schema-owned public boundary shapes                              | [Contracts](references/contracts.md)      |
| Boundary decoding and missing values                             | [Effect data](references/effect-data.md)  |
| Services, Layers, resources, state, and caches                   | [Services](references/effect-services.md) |
| TanStack Router, Effect Atom, and React ownership                | [Frontend](references/react.md)           |
| Durable Effect and application behavior tests                    | [Testing](references/testing.md)          |
| Installed and upstream library sources                           | [Sources](references/sources.md)          |
