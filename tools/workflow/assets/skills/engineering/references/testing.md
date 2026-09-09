# Effect Behavior Tests

Add a durable test when the regression cost warrants it. Use the narrowest public seam and derive expectations independently from current requirements. Cover that behavior's reachable typed failures and observable boundary semantics. Control its dependencies, state, time, concurrency, and lifetime.

| Include                                                   | Exclude                                        |
| --------------------------------------------------------- | ---------------------------------------------- |
| Current public application, service, and helper behavior  | Static type shape                              |
| Reachable typed failures through `Effect.exit`            | Impossible post-boundary inputs                |
| Observable Schema decoding, defaults, and transformations | Private implementation branches                |
| Logic with controlled surrounding Layers                  | Generated scaffolding and presentation details |
| Approved tracing or transport behavior                    | Third-party internals                          |

Existing behavior is not a requirement by itself. Remove tests for superseded behavior in the same change. Do not retain compatibility tests or alternate historical paths. Test trace output or real transport behavior only when it is part of the current approved contract.

Use fresh test Layers by default. Share an expensive lifecycle through `it.layer` only intentionally and account for shared harness state. The behavior owner provides reusable test Layers beside its public fixture. Consumers reuse those Layers instead of duplicating assembly. Use `Layer.succeed` for a constructed service and `Layer.effect` for effectful or scoped acquisition.

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

Use effectful property tests for meaningful invariants and `TestSchema` assertions for contractual Schema behavior. Inspect `@effect/vitest` and Effect's maintained tests for exact runner, clock, console, scope, and memoization behavior when needed. Do not copy a fixed property run count into unrelated tests.
