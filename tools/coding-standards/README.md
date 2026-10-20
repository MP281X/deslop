# @deslop/coding-standards

A strict Oxlint preset, and three skills for Claude Code, Codex and OpenCode: `lint-companion` (the shapes to write first so the preset passes on the first run), `delivery` and `review`. `review` judges a diff against the repository's `CODING_STANDARDS.md`.

```bash
vpx @deslop/coding-standards@latest                   # copy the skills into the repository's .claude, .codex, .opencode or .agents
vp add -D @deslop/coding-standards @effect/tsgo
vp exec effect-tsgo patch --no-typescript --oxlint    # the preset needs the patched Oxlint; keep this in `prepare`
```

```ts
import {defineConfig} from 'vite-plus'

import {oxlint} from '@deslop/coding-standards'

export default defineConfig({lint: {extends: [oxlint]}})
```

The preset's fixes leave work for the formatter, so run `vp fmt` after `vp check --fix`. Your own `ignorePatterns` replace the preset's, so repeat `**/*.gen.ts`.
