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

Each judged rule is a file in `src/rules/` like any other, holding its question, its criteria and a bad/good example pair. `judge` asks only about units that are new or changed since the checkout left `--base` (default `origin/HEAD`), so the cost follows the change on any machine, however cold its cache. Verdicts are cached in `~/.cache/deslop-judge` by unit text and file imports, one answer per question, so a rerun asks nothing new and a reworded question asks only itself again. Without a cached verdict, as for an unchanged unit or in CI, a judged rule stays quiet. A message ending in "Judged 0.87" is fixed, or kept with `// judge-ignore <rule> -- <reason>` in the comment lines above the unit, which lint reports as stale once Jev scores the unit below 0.5. `judge --examples` checks that each still tells its bad example from its good one. `lint` ships the judged rules off; Deslop turns them on by adding `deslopRules` to its own config's `rules`.
