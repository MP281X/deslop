# Effect Services

Define each service with an explicit public interface and named Layers, separate from its implementation. Infer constructor-local requirements, errors, and values; consumers use the public interface and Layers rather than assembling implementation details.

Expose a useful Effect state primitive such as `SubscriptionRef` as the intentional public interface for both snapshots and subscriptions; do not hide it behind read or stream wrappers. Its mutation API remains accessible even when consumers conventionally use it only to observe published state.

In this example, `WorkspaceState` is an existing Schema-inferred plain-record type, and `Workspace` has a separate public interface whose `state` is a `SubscriptionRef<WorkspaceState>`. The initial state and update input are already boundary-decoded. The private constructor stays flat:

```ts
const makeWorkspace = (initial: WorkspaceState) =>
	pipe(
		SubscriptionRef.make(initial),
		Effect.map(state =>
			Workspace.of({state, update: input => SubscriptionRef.update(state, current => ({...current, name: input.name}))})
		)
	)
```

Suppress equivalent updates only when unchanged state must not emit; preserve repeated equal values when they are meaningful events.

## Lifetime

| Requirement                             | Primitive     |
| --------------------------------------- | ------------- |
| Shared service in one Layer graph build | Named Layer   |
| Keyed service dependency graph          | `LayerMap`    |
| Keyed scoped acquired value             | `RcMap`       |
| Reused unscoped lookup result           | `Cache`       |
| Reused scoped lookup result             | `ScopedCache` |

Plain immutable keyed data belongs in `HashMap` or `Record`; a key alone does not justify caching, scope, or idle expiration.

A named Layer is shared when the same Layer identity is used within one graph build and memoization context. The application root composes the complete graph. For example, when `ApiLive` and `JobsLive` both require `Counter`:

```ts
const AppLive = pipe(Layer.merge(ApiLive, JobsLive), Layer.provide(Counter.layer))
```

Use native resource management. Library-scoped APIs already own their cleanup. Tie a service-lifetime resource to its owning scope with `Effect.acquireRelease` or an owned finalizer. For an unscoped resource used within one operation, acquire, use, and release it together. When the functions are receiver-independent and their signatures match:

```ts
const content = yield * Effect.acquireUseRelease(open, read, close)
```

The owner handles cleanup after success, failure, and interruption. Keep the resource and its release obligation together.
