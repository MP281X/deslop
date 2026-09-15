# Effect Behavior Tests

## Requirements

| Lead        | Requirement                                                 |
| ----------- | ----------------------------------------------------------- |
| Seam        | Narrowest public seam                                       |
| Expectation | Derived independently from approved requirements            |
| Failure     | Every reachable typed failure                               |
| Runtime     | Deterministic Effect state, lifetime, concurrency, and time |

| Include                                                               | Exclude                                          |
| --------------------------------------------------------------------- | ------------------------------------------------ |
| Public application, service, and helper behavior                      | Static type shape                                |
| Reachable typed failures via `Effect.exit`                            | Impossible post-boundary inputs                  |
| Boundary decoding or defaults when observable through the public seam | Private implementation branches                  |
| Current contract across implementations                               | Removed or compatibility behavior                |
| Logic with controlled surrounding Layers                              | Third-party behavior, traces, or live transports |
| Application behavior                                                  | React implementation details                     |

| Schema behavior contractual? | Test decoding, encoding, arbitrary generation, or transformation |
| ---------------------------- | ---------------------------------------------------------------- |
| Yes                          | Include                                                          |
| No                           | Exclude                                                          |

## Effect test environment

| Test owner                       | Scope             | Clock / console                            |
| -------------------------------- | ----------------- | ------------------------------------------ |
| `it.effect`                      | Fresh per test    | Fresh `TestClock` and `TestConsole`        |
| Nested `it.effect` in `it.layer` | Fresh child scope | Cached block `TestClock` and `TestConsole` |

| Operation                             | Requirements                                                                                       |
| ------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `TestClock.adjust`                    | Advance scheduled work from epoch zero                                                             |
| `TestConsole.logLines` / `errorLines` | Read flattened call parameters                                                                     |
| `Effect.exit(program)`                | Assert typed failure, defect, or interruption without changing error channel                       |
| `Effect.addFinalizer`                 | Scope owns cleanup                                                                                 |
| `Effect.acquireRelease`               | Acquired value and release action form one resource owner. Release receives value and scope `Exit` |

## Layers and fixtures

| Implementation              | Ownership                                                                     |
| --------------------------- | ----------------------------------------------------------------------------- |
| `Layer.succeed(Key, value)` | Already constructed immutable test service                                    |
| `Layer.effect(Key)(effect)` | Effectful or scoped service acquisition. The Layer owns the acquisition scope |
| `it.layer(layer)`           | One memoized Layer context shared by all tests in its block, closed afterward |

| Requirement                 | Implementation                                                                    |
| --------------------------- | --------------------------------------------------------------------------------- |
| Scoped Layer acquisition    | `Layer.effect` with `Scope`. Use `Effect.acquireRelease` or `Effect.addFinalizer` |
| Default test fixture        | Fresh Layer per test                                                              |
| Shared expensive lifecycle  | `it.layer`                                                                        |
| Separate `it.layer` calls   | Distinct memo maps                                                                |
| Shared Layer entries        | Same explicit `memoMap`                                                           |
| Reusable public fixture     | Test Layer beside the behavior owner                                              |
| Duplicate consumer assembly | Forbidden                                                                         |

```ts
const TestService = Layer.effect(Service)(Effect.acquireRelease(acquire, (service, exit) => release(service, exit)))

it.layer(TestService)('shared service lifecycle', it => {
	it.effect('first behavior', () => Service.pipe(Effect.flatMap(useFirst)))
	it.effect('second behavior', () => Service.pipe(Effect.flatMap(useSecond)))
})
```

## State and concurrency

| Primitive                         | Test contract                                                                                  |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `Ref`                             | Atomic mutable test state                                                                      |
| `Deferred`                        | One-shot readiness or completion. Await instead of sleeping                                    |
| `Effect.forkChild` + `Fiber.join` | Supervised work with propagated result and failure                                             |
| `Queue`                           | Test capacity, strategy, suspension, terminal failure, and ordering only when public           |
| `PubSub`                          | Subscribe before publish unless replay is contractual. Test configured behavior, not internals |
| `Semaphore`                       | Use `withPermits`. Test contention or bounds only when externally observable                   |

1. Subscribe before mutation.
2. Signal readiness with `Deferred`.
3. Collect a finite stream.
4. Compare the `Stream.runCollect` array.

```ts
it.effect(
	'publishes current state and updates',
	Effect.fnUntraced(function* () {
		const state = yield* SubscriptionRef.make(0)
		const ready = yield* Deferred.make<void>()
		const values = yield* SubscriptionRef.changes(state).pipe(
			Stream.tap(() => Deferred.succeed(ready, undefined)),
			Stream.take(3),
			Stream.runCollect,
			Effect.forkChild
		)

		yield* Deferred.await(ready)
		yield* SubscriptionRef.set(state, 1)
		yield* SubscriptionRef.set(state, 2)
		expect(yield* Fiber.join(values)).toEqual([0, 1, 2])
	})
)
```

## Generative And Schema Behavior

| Requirement                           | Implementation                              |
| ------------------------------------- | ------------------------------------------- |
| Effectful property                    | `it.effect.prop`                            |
| Input                                 | FastCheck arbitrary, Effect schema, or both |
| Run configuration                     | `{fastCheck: {...}}`                        |
| Contractual schema behavior           | `TestSchema.Asserts`                        |
| Schema input to synchronous `it.prop` | Forbidden                                   |

```ts
it.effect.prop(
	'invariant',
	{value: Schema.Int, suffix: FastCheck.string()},
	({value, suffix}) => Effect.sync(() => expect(render(value, suffix)).toContain(suffix)),
	{fastCheck: {numRuns: 200}}
)
```
