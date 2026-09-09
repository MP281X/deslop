# Effect Behavior Tests

Add a durable test only for an app-owned decision or logic that can plausibly regress and is not guaranteed by types or a library contract. Exercise public inputs and results at the narrowest seam so implementation refactors do not force test changes. Prioritize realistic normal flows and select a meaningful app-owned failure semantic only when its regression cost warrants protection. Control dependencies, state, time, concurrency, and lifetime only as the behavior requires.

| Include                                                                | Exclude                                                                                                    |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Meaningful app-owned decisions and failure semantics                   | Types and behavior guaranteed by a library contract                                                        |
| Custom boundary decisions beyond built-in validation or transformation | Built-in Schema compositions and decode-and-delegate pipelines whose behavior is entirely those operations |
| Public logic with controlled surrounding Layers                        | Impossible, contrived, or post-boundary invalid inputs                                                     |
| Approved tracing or transport behavior                                 | UI component details and third-party internals                                                             |

Existing behavior is not a requirement by itself. Remove tests for superseded behavior in the same change. Do not retain compatibility tests or alternate historical paths. Test trace output or real transport behavior only when it is part of the current approved contract.

Keep rendered interaction acceptance in Browser, where terminal visible output remains observable. Do not replace that acceptance with component tests or disable real output checks.

Use fresh local test Layers by default. Share an expensive lifecycle through `it.layer` only intentionally and account for shared harness state. Extract a shared fixture only when meaningful setup is duplicated. Use `Layer.succeed` for a constructed service and `Layer.effect` for effectful or scoped acquisition.

| Need                                   | Primitive                                                            |
| -------------------------------------- | -------------------------------------------------------------------- |
| Typed failure, defect, or interruption | `Effect.exit`                                                        |
| Owned cleanup                          | `Effect.acquireRelease` / `Effect.addFinalizer` and the owning scope |
| Mutable controlled state               | `Ref`                                                                |
| Readiness or completion handshake      | `Deferred`                                                           |
| Supervised concurrent result           | `Effect.forkChild` and `Fiber.join`                                  |
| Scheduled time                         | `TestClock`                                                          |
| Observable console output              | `TestConsole`                                                        |
| Public buffering or ordering           | `Queue`                                                              |
| Public subscription behavior           | `PubSub`                                                             |
| Public contention or bounds            | `Semaphore.withPermits`                                              |

For stream tests, establish the subscription, signal readiness, mutate, and collect a finite result. Use a handshake instead of arbitrary sleeps. Do not test implementation-specific scheduling or synchronization unless its behavior is public.

```ts
const Title = Schema.Trim.check(Schema.isNonEmpty())
```

Do not test its trimming or rejection, or repeat those assertions through a forwarding handler. Test additional custom domain logic. Use effectful property tests only for meaningful app-owned invariants, and use `TestSchema` only for meaningful custom app-owned Schema behavior. Inspect the installed `@effect/vitest` and Effect source and maintained tests for exact runner, clock, console, scope, and memoization behavior when needed. Do not copy a fixed property run count into unrelated tests.
