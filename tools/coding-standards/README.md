# @deslop/coding-standards

A strict Vite+ lint preset, and three skills for Claude Code and Codex: `lint-companion` (the shapes to write first so the preset passes on the first run), `delivery` and `review`. `review` judges a diff against the repository's `CODING_STANDARDS.md`.

Requires Vite+ 1.3 or newer. Vite+ owns the linter, type-aware engine and plugin authoring APIs; do not install standalone `oxlint`, `oxlint-tsgolint` or `@oxlint/plugins`.

```bash
vpx @deslop/coding-standards@latest                   # copy the skills into the repository's .claude, .codex or .agents
vp add -D @deslop/coding-standards @effect/tsgo
vp exec effect-tsgo patch --no-typescript --oxlint    # patch Vite+'s bundled linter; keep this in `prepare`
```

```ts
import {defineConfig} from 'vite-plus'

import {lint} from '@deslop/coding-standards'

export default defineConfig({lint: {extends: [lint]}})
```

To migrate from the standalone preset, replace the `oxlint` import with `lint` and remove the standalone dependencies. Put project-specific settings alongside `extends`; its `ignorePatterns` do not carry over, so repeat `**/*.gen.ts` in your own ignores.

The preset's fixes leave work for the formatter, so run `vp fmt` after `vp check --fix`.
