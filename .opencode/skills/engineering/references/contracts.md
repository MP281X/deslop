# Public API Shape

One schema/type pair owns each public boundary shape, defaults, transformations, and validation.

```ts
// BAD
const State = Schema.Literal('open', 'done')

// GOOD
type State = typeof State.Type
const State = Schema.Literals(['open', 'done'])
```

```ts
// BAD
export interface CreateNote {
	text: string
}

export const CreateNote = Schema.Struct({text: Schema.String})

// GOOD
export type CreateNote = typeof CreateNote.Type
export const CreateNote = Schema.Struct({text: Schema.Trim})
```
