# Effect Services

## Live state

```ts
// BAD
return Workspace.of({
	changes: SubscriptionRef.changes(state),
	current: SubscriptionRef.get(state),
	set: value => SubscriptionRef.set(state, value)
})

// GOOD
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

Only the state owner mutates its exposed `SubscriptionRef`.

## Keyed lifetime

| Value                          | Owner         |
| ------------------------------ | ------------- |
| One application instance       | Named Layer   |
| Keyed service dependency graph | `LayerMap`    |
| Keyed scoped value             | `RcMap`       |
| Reused unscoped lookup         | `Cache`       |
| Reused scoped lookup           | `ScopedCache` |

```ts
// BAD
const workspaces = new Map<string, Workspace>()

// GOOD
const workspaces = yield * LayerMap.make(input => Workspace.layerLocal(input), {idleTimeToLive})
```

```ts
// BAD
const sessions = new Map<string, Session>()

// GOOD
const sessions = yield * RcMap.make({lookup: input => Session.make(input), idleTimeToLive})
```

## Scoped resources

```ts
// BAD
const connection = yield * driver.connect(input.url)

// GOOD
const connection = yield * Effect.acquireRelease(driver.connect(input.url), connection => driver.close(connection))
```
