# Static Enforcement

Static enforcement is a fallback for authoring mistakes. The engineering skill defines how code should be written, including rules that this repository cannot mechanically enforce.

Implementation owns the production-ready selection, implementation, fixtures, and validation of static enforcement. Use it only for precise, mechanically detectable behavior and finish the complete enforcement outcome in that owner.

## Owners

| Tool                     | Active owner                              | Available rules or source        |
| ------------------------ | ----------------------------------------- | -------------------------------- |
| TypeScript               | `tsconfig.json`                           | `typescript` reference           |
| Generic Oxlint and Oxfmt | `vite.config.ts`                          | `oxc` and `vite-plus` references |
| Fallow                   | `.fallowrc.json` and root `check` script  | `fallow` reference               |
| Custom Oxlint            | `tools/oxlint-rules/src/oxlint-plugin.ts` | Colocated tests                  |

## Selection

Prefer a configured maintained rule, then a compatible maintained option. Use custom Oxlint only when every gate below passes. Keep nonmechanical behavior in engineering guidance.

| Gate       | Requirement                   |
| ---------- | ----------------------------- |
| Frequency  | Frequent                      |
| Detection  | Precise and static            |
| Ownership  | No maintained equivalent      |
| Correction | Stable canonical construction |

## Implementation Proof

Prove terminal enforcement for the exact invalid form with failing fixtures and valid counterexamples at every configured integration point. Document unsupported cases and the narrowest syntax and path scope. Provide one canonical correction. Allow suppression only when irreducible, narrow, inline, and reasoned.
