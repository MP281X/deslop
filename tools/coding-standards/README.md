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
