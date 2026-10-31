# @deslop/coding-standards

A syntax-only Vite+ lint preset, a strict compiler configuration with Effect diagnostics, and three skills for Claude Code and Codex: `lint-companion`, `pull-requests` and `review`. Installing over a release that shipped `writing-code` leaves that directory behind; delete it.

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

- **Project settings** go beside `extends`; the preset ignores nothing, so add `**/*.gen.ts` to your own ignores.
- **Native rules** by name, every category off: tool upgrades opt into nothing. Deslop rules come from the local plugin registry, with no second list of names. Native rules own what they can express; custom rules cover the remaining Effect and React contracts.
- **Syntax only.** `typescript` plugin rules such as `no-explicit-any`, `consistent-type-imports` and `method-signature-style` need no type information; `typeAware: false` disables inferred-type rules such as `no-floating-promises`; `typeCheck: false` leaves compiler errors to the Effect-patched `tsrs` check.

## Collection performance

`no-accumulating-copy` checks inline Effect `Array.reduce`/`reduceRight` callbacks, including captured accumulator reads in nested callbacks:

```diff
-Array.reduce(items, [], (all, item) => [...all, transform(item)])
+Array.map(items, transform)
```

- **Also flags** Effect array append/prepend, `Record.set` and computed-key record spreads.
- **Instead**: `Array.mapAccum` for stateful selection; `MutableList`/`MutableHashMap` for local collectors.
- **Valid**: scalar folds, persistent `HashMap.set`, noncomputed object-property updates.
- **Intentional** snapshots, bounded windows or bounded key sets take a reasoned inline disable; the rule infers no growth and rewrites nothing.
- **`Array.contains`** is structural; for identity use `Array.containsWith(Equivalence.strictEqual())`, since a syntax-only preset can't infer the intended equality.
