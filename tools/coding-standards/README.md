# @deslop/coding-standards

A syntax-only Vite+ lint preset, a strict compiler configuration with Effect diagnostics, and three skills for Claude Code and Codex: `lint-companion`, `delivery` and `review`.

Vite+ owns syntax linting and plugin authoring APIs; Effect-patched tsrs owns compiler diagnostics.

```bash
vpx @deslop/coding-standards@latest
vp add -D @deslop/coding-standards@latest @effect/tsgo@latest tsrs@latest
```

```ts
import {defineConfig} from 'vite-plus'

import {lint} from '@deslop/coding-standards'

export default defineConfig({lint: {extends: [lint]}})
```

```jsonc
// package.json
{
	"scripts": {
		"prepare": "effect-tsgo patch --no-typescript --tsrs",
		"typecheck": "tsrs --noEmit --checkerAssignment go",
		"check": "vp check && vp run typecheck"
	}
}
```

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Put project-specific lint settings alongside `extends`; its `ignorePatterns` do not carry over, so repeat `**/*.gen.ts` in your own ignores.
