# @deslop/coding-standards

A Vite+ lint preset that runs the Effect rules and TypeScript diagnostics in Oxlint on tsrs, a strict TypeScript configuration, and a CLI that prints the lint tactics; no skill files are installed.

```bash
vpx @deslop/coding-standards@latest                                  # prints the lint tactics
vp add -D @deslop/coding-standards@latest @effect/tsgo@latest tsrs@latest
```

Add to the repository's `AGENTS.md`: when a diagnostic survives `vp run fix`, run `vpx @deslop/coding-standards@latest` and follow the printed instructions.

```ts
// vite.config.ts
import {defineConfig} from 'vite-plus'

import {lint} from '@deslop/coding-standards'

export default defineConfig({lint: {extends: [lint]}})
```

```jsonc
// package.json
{
	"scripts": {
		"prepare": "effect-tsgo patch --no-typescript --tsrs --oxlint",
		"check": "effect-tsgo --tsrs-lint vp lint --type-aware --type-check"
	}
}
```

The preset leaves type-aware lint and type checking off, so a syntax-only pass stays possible; the two flags turn them on, and `--tsrs-lint` runs them on tsrs instead of Oxlint's tsgolint backend.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

The preset ignores nothing, so add your generated files, such as `**/*.gen.ts`, to your own ignores.

## Judged rules

Some rules need judgment a parser lacks but not the rest of the codebase: whether a component fetches its own data, whether a test asserts on internals. Jev (TypeSafe's decision model on OpenRouter) answers each rule's question about one function, component or test case at a time, through a Deslop Gateway that spends the signed-in person's own OpenRouter key; the rules then report like any other.

```bash
deslop-coding-standards sign-in        # once per machine; approve its code in Auth or with answer_request
deslop-coding-standards judge --ignore '**/*.gen.ts'    # before lint in the fix task: units changed since origin/HEAD
deslop-coding-standards judge --all                     # every unit of the checkout
```

Each judged rule is a file in `src/rules/` like any other, holding its question, its criteria and a bad/good example pair. `judge` asks only about units that are new or changed since the checkout left `--base` (default `origin/HEAD`), so the cost follows the change on any machine, however cold its cache. Verdicts are cached in `~/.cache/deslop-judge` by unit text and file imports, one answer per question, so a rerun asks nothing new and a reworded question asks only itself again. Without a cached verdict, as for an unchanged unit or in CI, a judged rule stays quiet. A message ending in "Judged 0.87" is fixed, or kept with `// judge-ignore <rule> -- <reason>` in the comment lines above the unit, which lint reports as stale once Jev scores the unit below 0.5. `judge --examples` checks that each still tells its bad example from its good one. `lint` ships the checks of Deslop's own choices off (the judged rules, `icon-weight` and the SQL import ban); Deslop turns them on by adding `deslopRules` to its own config's `rules`.

## Policy

- **Once.** Each policy is defined once; only custom rules have tests; native rules are picked by name with every category off, so a tool upgrade opts into nothing; a declined rule is left out.
- **No overlap.** Each check lives in the one tool that covers it best, proven with the custom rule's failing cases; the compiler and the Effect rules own theirs; no rule repeats a form the preset already bans. A check a parser can make is a static rule; one that needs a single unit read with judgment is a judged rule; one that needs the whole codebase belongs to review.
- **One gate.** `check`, and `fix` in Verify, run Oxfmt, the typed Oxlint pass on tsrs with the Effect rules and TypeScript diagnostics, a syntax-only pass over templates, then Fallow; no package keeps a typecheck script.
- **Reach.** Only checks that can fire in the codebases using it, preventive ones included for patterns they already hit; `exactOptionalPropertyTypes` stays off.
- **Custom rules** earn their place with coverage or a safe fix no native rule offers, and intended forms stay accepted while fixes converge.
