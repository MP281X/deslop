---
name: engineering
description: 'Use for product-code guidelines, architecture, coding style, implementation, testing, or review.'
---

## Decisions

| Decision   | Requirement                                                                                                                                               |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Decode     | Decode unknown external data once at its boundary.                                                                                                        |
| Transform  | Preserve intact typed values. Transform shape only when approved requirements require it.                                                                 |
| Fail       | Compose Effect's typed error channel. Recover in Effect only when the current layer owns recovery. Otherwise preserve the error channel for its boundary. |
| Mutability | Keep arguments, props, service values, and returned values immutable without `readonly` syntax.                                                           |
| Name       | Use direct names, inferred local types, and domain operations.                                                                                            |
| Test       | Test durable behavior only when regression cost justifies it. Omit generated scaffolding and presentation-detail unit tests.                              |

## References

| Condition                                                                         | Reference                                 |
| --------------------------------------------------------------------------------- | ----------------------------------------- |
| Effect operation selection, composition, Stream, tracing, errors, and concurrency | [Effect](references/effect.md)            |
| Schema-owned public boundary shapes                                               | [Contracts](references/contracts.md)      |
| External boundary decoding and missing values                                     | [Effect data](references/effect-data.md)  |
| Effect services, Layers, resources, state, and caches when used                   | [Services](references/effect-services.md) |
| TanStack Router, Effect Atom, and React state placement                           | [Frontend](references/react.md)           |
| Durable Effect and application behavior tests                                     | [Testing](references/testing.md)          |
