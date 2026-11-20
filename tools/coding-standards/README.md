# @deslop/coding-standards

This package provides Vite+ lint and TypeScript presets and a `coding-standards` CLI.

```bash
vp add -D @deslop/coding-standards@latest vite-plus@latest @effect/tsgo@latest tsrs@latest
```

The preset and its plugins are ES modules, so the consuming `package.json` sets `"type": "module"`; the shared tsconfig expects `@types/node` and Vite+'s client types. Deslop runs it on Vite+ 1.7 and `@effect/tsgo` 0.73; earlier versions the peer ranges admit are unproven.

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

This consumer `fix` example prints tactics when lint fails; Deslop's own task prints them before fixing.

The preset leaves type-aware lint and type checking off, so a syntax-only pass stays possible; the two flags turn them on, and `--tsrs-lint` runs them on the Effect-patched tsrs.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Add your own ignores and repository-specific selectors alongside the preset's `lint.rules['eslint-js/no-restricted-syntax']`.

The shared compiler enables `exactOptionalPropertyTypes`: omit an absent optional property, or pass an `Option` through when absence is part of the value. Explicit `| undefined` is reserved for third-party contracts that require it.

## Rules

Each pattern has one owning check, so a site gets one report and one fix: a custom rule defers to a native rule or the Effect compiler where one already owns the pattern, and competing compiler rewrites stay off.

Rule diagnostics and their published examples are the reference for individual patterns. Custom rules read syntax only: Oxlint's JS plugin API exposes no TypeScript program.
