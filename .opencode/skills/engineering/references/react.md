# React, Effect Atom, And TanStack Router

| State                                         | Owner                         |
| --------------------------------------------- | ----------------------------- |
| Shareable or restorable navigation state      | TanStack Router search params |
| Cross-component, async, derived, or real-time | Effect Atom                   |
| Ephemeral DOM handle or input                 | React                         |

## Presentation Actions

Keep direct queries and mutations at their consumption site. Move only shared state, derived graphs, families, and subscriptions into modules. Expose mutation pending state and failure at the initiating control.

Keep a mutation's pending state and failure beside the control that launches it. Do not hide a shared mutation result in a module when only one presentation action consumes it.

## Stable Family Identity

```ts
// BAD
const itemAtom = Atom.family((key: string) => query(key))
const item = itemAtom(`${workspaceId}:${itemId}`)

// GOOD
type ItemKey = typeof ItemKey.Type
const ItemKey = Schema.Struct({itemId: Schema.String, workspaceId: Schema.String})

const itemAtom = Atom.family((key: ItemKey) => query(key))
const item = itemAtom({itemId, workspaceId})
```

## Derived State

```ts
// BAD: recomputed by every render consumer
const visible = Array.filter(useAtomSuspense(itemsAtom).value, Struct.get('visible'))

// GOOD: shared derivation belongs to the Atom graph
const visibleItemsAtom = Atom.mapResult(itemsAtom, Array.filter(Struct.get('visible')))
```

## Placement

| Value                                            | Scope                      |
| ------------------------------------------------ | -------------------------- |
| Direct query or mutation                         | Component consumption site |
| Shared Atom, derived graph, family, subscription | Module                     |
| DOM ref or browser synchronization               | Component                  |

Render query and stream results through Suspense and error boundaries. Keep DOM-local input state in React. Use React's native `null` form rather than adding redundant unions.

```tsx
// BAD
const inputRef = useRef<HTMLInputElement | null>(null)

// GOOD
const inputRef = useRef<HTMLInputElement>(null)
```

Keep rendering pure. Compute randomness, time, and external effects outside the component and pass stable values as props or Atom state.
