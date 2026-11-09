# @deslop/coding-standards

This package provides Vite+ lint and TypeScript presets and a `coding-standards` CLI. No skill files are installed.

```bash
vp add -D @deslop/coding-standards@latest @effect/tsgo@latest tsrs@latest
```

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
		"check": "effect-tsgo --tsrs-lint vp lint --type-aware --type-check",
		"fix": "effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check || { coding-standards; exit 1; }"
	}
}
```

`coding-standards` with no flag prints the lint tactics, so `fix` ends a diagnostic autofix leaves with them, for the agent fixing it.

The preset leaves type-aware lint and type checking off, so a syntax-only pass stays possible; the two flags turn them on, and `--tsrs-lint` runs them on tsrs instead of Oxlint's tsgolint backend.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Add your own ignores and opt into `deslopRules` for Deslop's own choices.

## Judge

Run `--judge` after `fix`, never in CI. Jev answers through a Deslop Gateway that spends the signed-in person's own OpenRouter key.

```bash
coding-standards sign-in                           # once per machine; approve its code in Auth or with answer_request
coding-standards --judge --ignore '**/*.gen.ts'    # its own task after fix; never in CI
```

Questions address a single function, component or test case, not codebase-wide decisions. The judge prints `path:line question message score` for findings and exits 1 on any finding or unanswered unit. To suppress a finding, put `// judge-ignore <question> -- <reason>` in the comment lines above the unit; stale suppressions are reported. Cached answers are shared by every checkout and repository.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
