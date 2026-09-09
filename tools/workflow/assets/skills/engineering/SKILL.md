---
name: engineering
description: 'Use for product-code architecture, implementation, coding style, testing, or review.'
---

Write code to these rules before static analysis. Apply the repository's project-engineering skill for its concrete architecture and conventions.

## Decisions

| Decision   | Requirement                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Boundary   | Decode unknown external input once through a Schema at the boundary that admits it. Trust and preserve the resulting typed value internally.                                                 |
| Shape      | Let one Schema and its inferred type own each public boundary shape, including required validation, defaults, and transformations.                                                           |
| Effect     | Put application logic, dependencies, failures, concurrency, resources, and external capabilities in Effect. Keep transformations pure and compose the matching Effect modules.               |
| Capability | Use installed libraries and their public APIs before writing equivalent custom logic. Use Effect services instead of native platform capabilities.                                           |
| Failure    | Preserve Effect's typed error channel. Recover only where a meaningful recovery policy is owned.                                                                                             |
| Mutation   | Do not mutate arguments, props, published service values, or returned data. Use owned Effect state for required changes without `readonly` syntax.                                           |
| Expression | Prefer explicit, idiomatic operations even when they are more verbose than native syntax. Do not hide simple logic, defaults, or signature changes behind wrappers.                          |
| Ownership  | Give each state value, validation, derived value, resource lifetime, service construction, and recovery policy one owner.                                                                    |
| Scope      | Implement the smallest complete form of the current requirement. Remove superseded paths, compatibility layers, redundant checks, and obsolete tests in the affected area. Git owns history. |
| Tests      | Add durable behavior tests when regression cost warrants them. Test the current contract at its narrowest public seam.                                                                       |
| Evidence   | Resolve uncertain library behavior from its implementation and maintained tests using the source catalog. Examples demonstrate choices; source defines behavior.                             |

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
