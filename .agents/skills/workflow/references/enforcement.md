# Static enforcement

Implementation owns the production-ready selection, implementation, fixtures, and validation of static enforcement. Use it only for precise, mechanically detectable behavior and finish the complete enforcement outcome in that owner.

## Owners

| Tool                   | Active owner                              | Available rules or source        |
| ---------------------- | ----------------------------------------- | -------------------------------- |
| TypeScript             | `tsconfig.json`                           | `typescript` reference           |
| Generic Oxlint · Oxfmt | `vite.config.ts`                          | `oxc` and `vite-plus` references |
| Fallow                 | `.fallowrc.json` · root `check` script    | `fallow` reference               |
| Custom Oxlint          | `tools/oxlint-rules/src/oxlint-plugin.ts` | colocated tests                  |

## Selection

Prefer a configured maintained rule, then a compatible maintained option. Otherwise use custom Oxlint only when every gate below passes; route nonmechanical behavior to its domain skill.

Add custom Oxlint only when every gate is satisfied:

| Gate       | Requirement                   |
| ---------- | ----------------------------- |
| Frequency  | Frequent                      |
| Detection  | Precise and static            |
| Ownership  | No maintained equivalent      |
| Correction | Stable canonical construction |

## Implementation proof

Prove the terminal enforcement behavior for the exact invalid form with failing fixtures and valid counterexamples, including every direct configured integration point. Document unsupported cases and the narrowest syntax and path scope. Provide one canonical correction. Allow suppression only when irreducible, narrow, inline, and reasoned.
