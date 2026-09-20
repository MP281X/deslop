# React, Effect Atom, And TanStack Router

| State or behavior                                            | Owner and placement           |
| ------------------------------------------------------------ | ----------------------------- |
| Shareable or restorable navigation                           | TanStack Router search params |
| Cross-component, async, reactive derived, or real-time state | Effect Atom                   |
| Shared Atom graph, family, or subscription                   | Module owning that graph      |
| Direct query or mutation                                     | Component consumption site    |
| Ephemeral input, DOM handle, or browser synchronization      | React component               |

Put shared derivations in the Atom graph rather than recomputing them in every consumer. A pure local display calculation does not require a shared Atom.

Use the normal Atom lifetime by default. Use `Atom.keepAlive` only when continuity is required while the Atom has no consumers.

```ts
const visibleItemsAtom = Atom.mapResult(itemsAtom, Array.filter(Struct.get('visible')))
```

Use immutable structured domain keys for Atom families instead of delimiter-joined strings. A Schema-defined record identifies its fields and Effect supplies structural equality. Do not mutate a key after use. In this illustrative case, `query` is an existing typed Atom factory whose single argument is the decoded domain key:

```ts
const itemAtom = Atom.family(query)
const item = itemAtom(itemKey)
```

Expose mutation pending state and failure beside the initiating control. Render query and stream results through Suspense and error boundaries. Keep DOM-local input in React and use its native null ref form.

```tsx
const inputRef = useRef<HTMLInputElement>(null)
```

Provide time, randomness, I/O, and other effects to rendering through props or Atom state. Let React Compiler own memoization.
