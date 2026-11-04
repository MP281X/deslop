# @deslop/coding-standards

A Vite+ lint preset that runs the Effect rules and TypeScript diagnostics in Oxlint on tsrs, a strict TypeScript configuration, and the `lint-companion`, `pull-requests` and `review` skills for Claude Code and Codex.

```bash
vpx @deslop/coding-standards@latest                                  # installs the skills
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
