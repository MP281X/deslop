# React, Effect Atom, And TanStack Router

Move application logic and state as far into Effect and Atom as their ownership allows. React owns rendering, DOM interaction, browser synchronization, and genuinely local input state.

| State or behavior                                            | Owner and placement           |
| ------------------------------------------------------------ | ----------------------------- |
| Shareable or restorable navigation                           | TanStack Router search params |
| Cross-component, async, reactive derived, or real-time state | Effect Atom                   |
| Shared Atom graph, family, or subscription                   | Module owning that graph      |
| Direct query or mutation                                     | Component consumption site    |
| Ephemeral input, DOM handle, or browser synchronization      | React component               |

Keep one state owner. Put shared derivations in the Atom graph rather than recomputing them in every consumer. A pure local display calculation does not require a shared Atom.

```ts
const visibleItemsAtom = Atom.mapResult(itemsAtom, Array.filter(Struct.get('visible')))
```

Use immutable structured domain keys for Atom families instead of delimiter-joined strings. A Schema-defined record identifies its fields and Effect supplies structural equality. Do not mutate a key after use.

```ts
type ItemKey = typeof ItemKey.Type
const ItemKey = Schema.Struct({itemId: Schema.String, workspaceId: Schema.String})

const itemAtom = Atom.family((key: ItemKey) => query(key))
const item = itemAtom({itemId, workspaceId})
```

Expose mutation pending state and failure beside the initiating control. Render query and stream results through Suspense and error boundaries. Keep DOM-local input in React and use its native null ref form.

```tsx
const inputRef = useRef<HTMLInputElement>(null)
```

Keep rendering pure. Produce time, randomness, I/O, and other effects outside render. Provide stable results through props or Atom state. Let React Compiler own memoization.
