# Public Contracts

One Schema/type pair owns each public boundary shape, including its validation, defaults, and transformations. Infer the public type from the Schema. Do not maintain a parallel interface or revalidate the value after the boundary admits it.

```ts
export type CreateNote = typeof CreateNote.Type
export const CreateNote = Schema.Struct({text: Schema.String})
```

Changing type ownership must preserve field semantics. Trimming, coercion, defaults, brands, or stricter validation require a current boundary requirement.

Represent invalid states in the Schema so internal code receives the narrowest truthful type. Prefer Schema-backed structures, brands, and tagged errors over parallel custom types. Infer local implementation types instead of publishing internal contracts.

Do not add manual guards for constraints already established by the decoded type. Decisions that require current authoritative state, such as authorization or resource existence, remain domain operations rather than repeated input validation.
