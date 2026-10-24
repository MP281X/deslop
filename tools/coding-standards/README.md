# @deslop/coding-standards

A syntax-only Vite+ lint preset, a strict compiler configuration with Effect diagnostics, and three skills for Claude Code and Codex: `lint-companion`, `delivery` and `review`.

Requires Vite+ 1.3 or newer, `@effect/tsgo` 0.57 and its supported tsrs snapshot. Vite+ owns syntax linting and plugin authoring APIs; do not install standalone `oxlint`, `oxlint-tsgolint` or `@oxlint/plugins`.

```bash
vpx @deslop/coding-standards@latest
vp add -D @deslop/coding-standards '@effect/tsgo@^0.57' tsrs@0.18.0-ts7.1.0-dev.20260929 typescript@latest
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
// tsconfig.json, repeated or extended by every checked project
{
	"extends": "@deslop/coding-standards/tsconfig.json",
	"compilerOptions": {
		"plugins": [
			{
				"name": "@effect/language-service",
				"overrides": [{"include": ["**/*.tsx"], "options": {"diagnosticSeverity": {"asyncFunction": "off"}}}]
			}
		]
	}
}
```

The patched compiler merges Effect severity maps across `extends`. Its TSX exception belongs in the consuming project or a repository-root base configuration, because override globs are relative to their declaring configuration. Do not replace the compiler step with stock tsrs: it silently omits Effect diagnostics. The supported snapshot is pinned because the patcher rejects unsupported versions. The binary is available on Linux x64/arm64 with glibc and macOS arm64.

For a workspace, check each app, package and tool as a separate project; a single root program can mix unrelated router registrations. Deslop's root `typecheck` command discovers every immediate workspace tsconfig, including new generated packages. JavaScript entrypoints are also checked.

The 106 existing Effect checks remain compiler errors; `strictBooleanExpressions` adds a partial replacement for typed truthiness linting. Native `require-await` and the raw `JSON.parse` restriction recover limited syntax checks. `no-implicit-coercion` is not enabled: its fixes call constructors shadowed by Effect namespace imports. General Promise handling, inferred `any`, detached methods and type-dependent coercion/spread checks are no longer enforced. Strict TypeScript is not a replacement for those rules.

Put project-specific lint settings alongside `extends`; its `ignorePatterns` do not carry over, so repeat `**/*.gen.ts` in your own ignores. Deslop additionally preserves the Effect exemptions for generated route trees, web UI primitives and SVGs in its repository base config; they remain typechecked.

The preset's fixes leave work for the formatter, so run `vp fmt` after `vp check --fix`.
