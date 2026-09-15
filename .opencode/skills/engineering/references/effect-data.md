# Effect data

## Boundary: decode once

```ts
// schema.ts
type CreateNote = typeof CreateNote.Type
const CreateNote = Schema.Struct({text: Schema.optional(Schema.Trim)})

// BAD: handlers.ts
create: input => pipe(input, Schema.decodeUnknownEffect(CreateNote), Effect.flatMap(notes.create))

// GOOD: handlers.ts
create: input => notes.create(input)
```

```ts
// BAD
const response: Search = JSON.parse(text)

// GOOD
const response = yield * Schema.decodeUnknownEffect(Schema.fromJsonString(Search))(text)
```

## Missing values

```ts
// BAD
function label(value?: string) {
	return Option.match(Option.fromNullishOr(value), {onNone: () => '*', onSome: String.trim})
}

// GOOD
function label(value?: string) {
	return UndefinedOr.match(value, {onUndefined: () => '*', onDefined: String.trim})
}
```

```ts
// BAD
const owner = repository.lookup(input.id)
if (Option.isNone(owner)) return Option.none()

return permissions.read(owner.value.ownerId)

// GOOD
return pipe(
	repository.lookup(input.id),
	Option.flatMap(item => permissions.read(item.ownerId))
)
```
