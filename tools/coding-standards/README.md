# Coding standards

Strict Oxlint preset and repository skill installer. Requires Node 26+; skill installation runs inside a Git repository, including linked worktrees.

## Install skills

```bash
vpx @deslop/coding-standards@latest
```

| Result                                 | Scope                                                                                              |
| -------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Engineering, design and testing skills | Git root's existing `.agents`, `.claude` and `.codex` directories; creates `.agents` if none exist |
| Refresh                                | Replaces only those three skill names; preserves other skills and global configuration             |
| Boundary                               | Rejects destinations escaping the repository or overlapping global configuration                   |

No repository dependency, manifest/lock change or lint configuration change. Treat installed skill copies as read-only; refresh through the CLI.

## Use the lint preset

```bash
vp add -D @deslop/coding-standards @effect/tsgo
vp exec effect-tsgo patch --no-typescript --oxlint
```

```ts
import {defineConfig} from 'vite-plus'
import {oxlint} from '@deslop/coding-standards'

export default defineConfig({lint: {extends: [oxlint]}})
```

The preset uses Effect-tsgo's patched Oxlint and compatible tsgolint; keep the patch command in the project's prepare script. Match upstream supported tool versions. The skill installer neither configures lint nor upgrades/patches its toolchain.

## Working here

| Owner      | Decision                                                                                                                                                                                    |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`     | Flat package structure; rules in `src/rules`, no separate plugin or install-test harness                                                                                                    |
| `skills/`  | Maintained engineering/design/testing sources; refresh repository copies from the TypeScript CLI, no build needed                                                                           |
| Lint rules | Prefer an equivalent maintained rule before custom enforcement; consumer code conforms to strict standards, not the reverse. Fix broken/imprecise rules, not inconvenient valid diagnostics |
| Rule proof | Existing public CLI regression cases, with accepted/rejected controls; no severity/exclusion workaround                                                                                     |

## Rejected shortcuts

| Candidate                                                | Reason                                                                                                       |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Blanket `unknown` type ban                               | Opaque SDK/framework contracts legitimately need it; narrow/decode before use instead of fabricating a shape |
| Functional preset or dependency just to replace `no-let` | The preset conflicts; a selective plugin adds dependencies for a tiny rule                                   |
| Syntax-only generator-failure rule                       | Factory-call syntax does not establish yieldability; the existing type-aware Effect rule owns that check     |

With workspace dependencies installed, from the repository root:

```bash
vp test run tools/coding-standards/src/rules/rules.test.ts
node tools/coding-standards/src/install.ts
```

## Skill inspiration

| Source                                                                                                                                                                                                                       | Used / boundary                                                                                                                                                                                   |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Matt Pocock's engineering skills](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering)                                                                                    | Caller-first contracts, causal debugging and one uncertain behavior at a time; no universal TDD                                                                                                   |
| [Cursor / pstack](https://github.com/cursor/plugins/tree/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/pstack)                                                                                                                    | Interface rationale, focused bug replay and defensible benchmarks; no playbook-stage machinery                                                                                                    |
| [Kit Langton's Effect skill](https://github.com/kitlangton/skills/tree/71195e36024ebd2e66c5beac946e81eafd5abc43/skills/effect)                                                                                               | Schema construction/optionality, checked against actual [Effect 4 source](https://github.com/Effect-TS/effect/tree/67ba4e46a11ccda0b6761578bfd22c04ae00167d/packages/effect/src)                  |
| [Vercel's agent skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills)                                                                                                    | Independent I/O and narrow subscriptions, translated to Effect/atoms; no manual React memoization                                                                                                 |
| [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design), [Taste Skill](https://github.com/Leonxlnx/taste-skill), [Vercel design guidelines](https://vercel.com/design/guidelines) | Task-led composition, typography and useful copy; no forced novelty, arbitrary aesthetic bans or plugin bundle                                                                                    |
| [Emil Kowalski's skills](https://github.com/emilkowalski/skills/tree/e8a175de22ae1e49370fc144c1f3bb9aeedf988d/skills)                                                                                                        | Realistic layout stress, interruptible motion and mobile checks; no fixed variant picker or audit fan-out. Performance caveats checked against [Motion docs](https://motion.dev/docs/performance) |
| [Dillon Mulroy's skills](https://github.com/dmmulroy/skills/tree/8603380821fee6a77c82639f364ce8fe4f5a92be) and [anti-slop](https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b)              | Reviewed Effect/error and cleanup approaches; retain our own service layout and ownership                                                                                                         |
| [Awesome DESIGN.md](https://github.com/VoltAgent/awesome-design-md) and [Impeccable](https://github.com/pbakaus/impeccable)                                                                                                  | Reviewed reference collections; community brand analyses are inspiration, not authoritative/current tokens                                                                                        |

These are selectively adapted ideas, not imported frameworks. Concrete behavior, existing stack and settled user decisions govern the maintained skills.
