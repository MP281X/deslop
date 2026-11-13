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

Native rules enforce function declarations, standalone `pipe`, no ternaries and Unicode regular expressions (`u` or `v`). The preset loads only `no-restricted-syntax` from `oxlint-plugin-eslint` to reject `let`, switches, binary `in` checks and RPC names other than `<service folder>.<verb>`. These replacements report violations without the former custom migration fixes.

Custom rules retain the cases native rules cannot express: `prefer-predicate` owns runtime `typeof` and replaceable type-guard wrappers; `no-intermediate-collection` owns collections materialized only for a count, first item or emptiness check; `no-trivial-indirection` includes constant-return helpers and adjacent Option wrap/unwrap operations. Delimiter and schema encode/decode round trips are not assumed to preserve a value. Private derived-type aliases remain derived through generic wrappers. Boolean-name checks use explicit AST type annotations where available; Oxlint's JS plugin API exposes no TypeScript program, so opaque inferred calls remain outside that check.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Add your own ignores and opt into `deslopRules` for Deslop's own choices.

## Judge

`--judge` runs by hand, once per pull request after `fix` and the tests pass, then once more after its findings are fixed; never in CI or inside `fix`, `check` or `test`. Jev answers through a Deslop Gateway that spends the signed-in person's own OpenRouter key.

```bash
coding-standards sign-in                           # once per machine; approve its code in Auth or with answer_request
coding-standards --judge --ignore '**/*.gen.ts'    # by hand, once per pull request; never in CI
```

Questions address a single function, component or test case, not codebase-wide decisions. A question with a gate is asked only of the units it admits: a gate reads only what Jev reads, the unit's code and the imports it uses, and admits every unit the answer could be yes for. A gate that skips its own question's yes example fails the judge without a model call.

A unit's unanswered questions go to Jev together in one call. The answers live in one record per unit, keyed by its code and the imports it uses, in the user's cache directory (`~/.cache/coding-standards` on Linux), shared by every checkout and repository; each answer in it belongs to one question, so a run asks only edited code, and a reworded or added question asks only itself. A call missing one answer remembers nothing. Nothing expires: the folder can be deleted at any time, and the next run asks again.

The judge prints `path:line question message score` for findings, then a summary of units, questions asked, answered from memory and skipped by gates, calls and cost, and exits 1 on any finding or unanswered question. To suppress a finding, put `// judge-ignore <question> -- <reason>` in the comment lines above the unit; a suppression is reported once Jev clearly answers no or the question's gate skips the unit.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
