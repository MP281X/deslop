# Effect Data

Decode external serialized input directly through the owning Schema. Invoke the decoder where the value is consumed instead of storing a decoder wrapper.

```ts
// text is already a string; Search owns the decoded JSON shape.
const response = yield * Schema.decodeEffect(Schema.fromJsonString(Search))(text)
```

Change the boundary Schema when field selection, defaults, or normalization belong to the contract.

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
