---
name: engineering
description: 'Use for product-code architecture, implementation, coding style, testing, or review.'
---

Write code to these rules before static analysis. Apply the repository's project-engineering skill for its concrete architecture and conventions.

## Decisions

| Decision   | Requirement                                                                                                                                                                                                                         |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary   | Decode unsafe data once through a Schema at the real external boundary that admits it. Normalize there when the contract requires a canonical internal representation, then trust the result.                                       |
| Shape      | Let one Schema and its inferred type own each public boundary shape. Infer implementation types; do not add parallel interfaces, needless annotations, casts, or internal revalidation.                                             |
| Effect     | Represent effectful application logic, dependencies, failures, sequencing, concurrency, resources, and external capabilities compositionally in Effect and execute them through the owning runtime. Keep pure transformations pure. |
| Capability | Fully use installed libraries and idiomatic Effect modules before custom logic. Inspect the installed source, types, and maintained tests for exact API signatures and semantics.                                                   |
| Failure    | Fail fast through Effect's typed error channel to its established boundary and formatter. Recover, retry, or default only for agreed product behavior.                                                                              |
| Mutation   | Do not mutate arguments, props, published service values, or returned data. Use owned Effect state for required changes without `readonly` syntax.                                                                                  |
| Expression | Prefer explicit, composable, locally readable code even when verbose. Add a helper, layer, or file only for genuine complexity or a shared rule needing one owner, never naming or reuse alone.                                     |
| Ownership  | Give each state value, validation, derived value, resource lifetime, service construction, and recovery policy one owner.                                                                                                           |
| Scope      | Implement the smallest complete current MVP. Add no speculative behavior, adapter, compatibility path, or broad module refactor. Remove superseded code only in the approved affected behavior.                                     |
| Tests      | Test only app-owned decisions or logic whose plausible regression cost warrants durable protection, through public inputs and results.                                                                                              |
| Evidence   | Inspect affected code and direct dependencies before changing them. Examples demonstrate choices; installed source and types define library behavior.                                                                               |

## References

| Need                                                             | Read                                      |
| ---------------------------------------------------------------- | ----------------------------------------- |
| Effect operations, composition, tracing, errors, and concurrency | [Effect](references/effect.md)            |
| Schema-owned public boundary shapes                              | [Contracts](references/contracts.md)      |
| Boundary decoding and missing values                             | [Effect data](references/effect-data.md)  |
| Services, Layers, resources, state, and caches                   | [Services](references/effect-services.md) |
| TanStack Router, Effect Atom, and React ownership                | [Frontend](references/react.md)           |
| Durable Effect and application behavior tests                    | [Testing](references/testing.md)          |
| Upstream implementation or exemplar                              | [Sources](references/sources.md)          |
