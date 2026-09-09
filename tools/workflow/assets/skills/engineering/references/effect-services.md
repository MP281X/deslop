# Effect Services

The service owner defines an explicit public interface and named Layers. Keep that contract separate from its implementation, including for small services, to support isolated testing and code splitting. Infer implementation requirements, errors, and local values through service construction helpers without deriving the interface from the constructor. Consumers use the interface and exposed Layers instead of duplicating shapes or assembling implementation details.

Expose a useful Effect state primitive such as `SubscriptionRef` as the intentional public interface for both snapshots and subscriptions; do not hide it behind read or stream wrappers. By service convention, consumers use it to observe published state and leave semantic mutations to the owning service. This convention does not make the primitive's mutation API inaccessible.

```ts
return Workspace.of({
	state,
	update: Effect.fn('Workspace.update')(input =>
		SubscriptionRef.modifySome(state, current => {
			const next = WorkspaceState.make({...current, name: input.name})
			if (Schema.toEquivalence(WorkspaceState)(current, next)) return Tuple.make(undefined, Option.none())
			return Tuple.make(undefined, Option.some(next))
		})
	)
})
```

Suppress equivalent state updates when unchanged state must not emit. Preserve repeated equal values when they are meaningful events.

## Lifetime

| Requirement                             | Primitive     |
| --------------------------------------- | ------------- |
| Shared service in one Layer graph build | Named Layer   |
| Keyed service dependency graph          | `LayerMap`    |
| Keyed scoped acquired value             | `RcMap`       |
| Reused unscoped lookup result           | `Cache`       |
| Reused scoped lookup result             | `ScopedCache` |

Choose a primitive for its acquisition, sharing, invalidation, and release semantics. Plain immutable keyed data belongs in `HashMap` or `Record`. A key alone does not justify caching, scope, or idle expiration.

A named Layer is shared when the same Layer identity is used within one graph build and memoization context. The application root composes the complete graph. For example, when `ApiLive` and `JobsLive` both require `Counter`:

```ts
const AppLive = pipe(Layer.merge(ApiLive, JobsLive), Layer.provide(Counter.layer))
```

Tie external acquisition to release with `Effect.acquireRelease` or a finalizer owned by the acquiring scope.

```ts
const connection = yield * Effect.acquireRelease(driver.connect(input.url), connection => driver.close(connection))
```

The owning scope handles cleanup after success, failure, and interruption. Keep the resource and its release obligation together.
