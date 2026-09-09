# Effect Data

## Decode Once

Decode unknown data at the boundary that admits it. A Schema declaration or TypeScript annotation does not establish validation. Once RPC or another ingress boundary has decoded a value, handlers and services trust that type and do not repeat the check.

```ts
// The RPC boundary decoded input with CreateNote.
create: input => notes.create(input)
```

Decode external serialized input directly through the owning Schema. Invoke the decoder where the value is consumed instead of storing a decoder wrapper.

```ts
// text is already a string; Search owns the decoded JSON shape.
const response = yield * Schema.decodeEffect(Schema.fromJsonString(Search))(text)
```

Do not reconstruct a decoded value to select its fields, inject defaults, or normalize it again. Change the boundary Schema when those semantics belong to the contract.

## Missing Values

Preserve the existing representation of absence. Use `UndefinedOr` for undefined, `Option` operations for Option, and the domain's explicit null semantics when required. Do not convert representations only to use another combinator.

```ts
function label(value?: string) {
	return UndefinedOr.match(value, {onUndefined: () => '*', onDefined: String.trim})
}
```

Compose dependent optional lookups directly.

```ts
return pipe(
	repository.lookup(input.id),
	Option.flatMap(item => permissions.read(item.ownerId))
)
```

Use `??` when only null or undefined selects a fallback. Use `||` only when every falsy value must select it.
