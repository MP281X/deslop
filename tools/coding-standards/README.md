# @deslop/coding-standards

A syntax-only Vite+ lint preset, a strict compiler configuration with Effect diagnostics, and three skills for Claude Code and Codex: `writing-code`, `pull-requests` and `review`.

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

Put project-specific lint settings alongside `extends`; the preset ignores nothing, so add `**/*.gen.ts` to your own ignores.

Native rules are explicitly enabled by name, with every category off. Tool upgrades do not opt the project into new category members. Deslop rules are enabled from the local plugin registry, without a second list of names. Native rules own checks they can express; custom rules cover the remaining Effect and React contracts.

The `typescript` plugin includes syntax-only rules such as `no-explicit-any`, `consistent-type-imports` and `method-signature-style`; these run without type information. `typeAware: false` disables rules requiring inferred types, such as `no-floating-promises`. `typeCheck: false` leaves compiler errors to the separate Effect-patched `tsrs` check. The preset does not select inactive type-aware rules.

## Collection performance

`no-accumulating-copy` checks inline Effect `Array.reduce`/`reduceRight` callbacks, including captured accumulator reads in nested callbacks:

```diff
-Array.reduce(items, [], (all, item) => [...all, transform(item)])
+Array.map(items, transform)
```

It also recognizes Effect array append/prepend operations, `Record.set` and computed-key record spreads. Stateful selection can use `Array.mapAccum`; local collectors use `MutableList`/`MutableHashMap`. Scalar folds, persistent `HashMap.set` and noncomputed object-property updates stay valid. Intentional snapshots, bounded windows or bounded key sets need a reasoned inline disable; the rule does not infer growth or rewrite semantics.

`Array.contains` uses structural equality. For object identity, use `Array.containsWith(Equivalence.strictEqual())`; the syntax-only preset cannot infer which equality a caller intends.
