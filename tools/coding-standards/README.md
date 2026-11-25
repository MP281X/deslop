# @deslop/coding-standards

```bash
vp add -D @deslop/coding-standards@latest vite-plus@latest @effect/tsgo@latest tsrs@latest
```

The preset and its plugins are ES modules, so the consuming `package.json` sets `"type": "module"`; the shared tsconfig expects `@types/node` and Vite+'s client types. Use Vite+ 1.7 and `@effect/tsgo` 0.73: Deslop runs on them, and earlier versions the peer ranges admit are unproven.

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
		"fix": "effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check || { coding-standards tactics; exit 1; }"
	}
}
```

The preset leaves type-aware lint and type checking off, so the scripts turn them on.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Add ignores and repository-specific selectors to the preset's `lint.rules['eslint-js/no-restricted-syntax']`, not in place of it.

Under the shared compiler's `exactOptionalPropertyTypes`, omit an absent optional property, or pass an `Option` through when absence is part of the value. Use explicit `| undefined` only for third-party contracts that require it.
