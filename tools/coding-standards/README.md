# @deslop/coding-standards

A Vite+ lint preset, a strict TypeScript configuration with Effect diagnostics, and the `lint-companion`, `pull-requests` and `review` skills for Claude Code and Codex.

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

The preset ignores nothing, so add your generated files, such as `**/*.gen.ts`, to your own ignores.
