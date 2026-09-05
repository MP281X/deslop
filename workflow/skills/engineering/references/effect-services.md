# Effect Services

The service owner defines its public interface and named Layers. Infer implementation requirements, errors, and values through service construction helpers. Consumers use the interface and exposed Layers instead of duplicating shapes or assembling implementation details.

Expose a useful Effect state primitive such as `SubscriptionRef` instead of wrapping each native operation. Keep semantic mutations at the owning service. Consumers observe published state without mutating it.

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

| Requirement                      | Primitive     |
| -------------------------------- | ------------- |
| One application service instance | Named Layer   |
| Keyed service dependency graph   | `LayerMap`    |
| Keyed scoped acquired value      | `RcMap`       |
| Reused unscoped lookup result    | `Cache`       |
| Reused scoped lookup result      | `ScopedCache` |

Choose a primitive for its acquisition, sharing, invalidation, and release semantics. Plain immutable keyed data belongs in `HashMap` or `Record`. A key alone does not justify caching, scope, or idle expiration.

Tie external acquisition to release with `Effect.acquireRelease` or a finalizer owned by the acquiring scope.

```ts
const connection = yield * Effect.acquireRelease(driver.connect(input.url), connection => driver.close(connection))
```

The owning scope handles cleanup after success, failure, and interruption. Keep the resource and its release obligation together.
