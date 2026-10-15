# Coding standards

A strict Oxlint preset and an installer for the architecture, engineering, design, testing and review skills. Requires Node 26+.

## Install the skills

Run inside a Git repository, including a linked worktree:

```bash
vpx @deslop/coding-standards@latest
```

It copies all package-owned skills into the repository's existing `.agents`, `.claude` and `.codex` directories, including their `EVALS.md`. It always writes `.claude`, which Claude Code reads, and writes `.agents` when no `.codex` exists. A refresh replaces only those names; destinations outside the repository or inside global agent configuration are rejected. Other skills, sign-ins, manifests, lockfiles and lint configuration stay unchanged. Edit package sources, then refresh installed copies with the CLI.

Use architecture for mechanisms and ownership, engineering for code, design for visible behavior, testing for useful proof and review for independent critique and cleanup. Refer to another skill by name, not its installation path. Personal orchestration, delivery, machine commands and reply preferences stay outside this package.

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

The preset needs Effect-tsgo's patched Oxlint, so keep the patch command in the project's `prepare` script. Its fixes leave redundant parentheses and blank lines for the formatter, so the project's fix script runs `vp fmt` after `vp check --fix`, even when diagnostics remain, and exits with the status of the check.

<details>
<summary>For agents</summary>

### Decisions

| Owner      | Decision                                                                                                                                                                                                                                                                                                                                                                      |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/`     | Flat package structure; rules in `src/rules`, no separate plugin or install-test harness                                                                                                                                                                                                                                                                                      |
| `skills/`  | Maintained architecture, engineering, design, testing and review sources; refresh repository copies from the TypeScript CLI, no build needed                                                                                                                                                                                                                                  |
| Lint rules | Prefer an equivalent maintained rule before custom enforcement; consumer code conforms to strict standards, not the reverse. Fix broken or imprecise rules, not inconvenient valid diagnostics. A rule targets code the engineering skill and the other rules allow; an edge case that only unusual code reaches takes an inline disable with its reason, never a looser rule |
| Rule proof | Existing public CLI regression cases, with accepted and rejected controls; no severity or exclusion workaround                                                                                                                                                                                                                                                                |

With workspace dependencies installed, from the repository root:

```bash
vp test run tools/coding-standards/src/rules/rules.test.ts
node tools/coding-standards/src/install.ts
```

### Rejected shortcuts

| Candidate                                                | Reason                                                                                                              |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Blanket `unknown` type ban                               | Opaque SDK and framework contracts legitimately need it; narrow or decode before use instead of fabricating a shape |
| Functional preset or dependency just to replace `no-let` | The preset conflicts; a selective plugin adds dependencies for a tiny rule                                          |
| Syntax-only generator-failure rule                       | Factory-call syntax does not establish yieldability; the existing type-aware Effect rule owns that check            |

### Skill sources

| Source                                                                                                                                                                                                                                                                                                                                                                                               | Used and boundary                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Matt Pocock's engineering skills](https://github.com/mattpocock/skills/tree/d81f3a183412e71a5b1e84ca21bc1a35eea03a60/skills/engineering)                                                                                                                                                                                                                                                            | Caller-first contracts, causal debugging and one uncertain behavior at a time; no universal TDD                                                                                                   |
| [Cursor / pstack](https://github.com/cursor/plugins/tree/e43c7ee26e0038c6c1fa8380dd34ce86ff94cb2a/pstack)                                                                                                                                                                                                                                                                                            | Interface rationale, focused bug replay and defensible benchmarks; no playbook-stage machinery                                                                                                    |
| [Kit Langton's Effect skill](https://github.com/kitlangton/skills/tree/71195e36024ebd2e66c5beac946e81eafd5abc43/skills/effect)                                                                                                                                                                                                                                                                       | Schema construction/optionality, checked against actual [Effect 4 source](https://github.com/Effect-TS/effect/tree/67ba4e46a11ccda0b6761578bfd22c04ae00167d/packages/effect/src)                  |
| [Vercel's agent skills](https://github.com/vercel-labs/agent-skills/tree/063bee94c3f4df8453406c830b0a7df0f2860278/skills)                                                                                                                                                                                                                                                                            | Independent I/O and narrow subscriptions, translated to Effect/atoms; no manual React memoization                                                                                                 |
| [Anthropic frontend-design](https://github.com/anthropics/skills/tree/main/skills/frontend-design) and [Vercel design guidelines](https://vercel.com/design/guidelines)                                                                                                                                                                                                                              | Task-led composition, copy and interaction contracts (targets, focus, URL state, forms); creative mode keeps grounding and the generated-default list, not a studio persona                       |
| [Emil Kowalski's skills](https://github.com/emilkowalski/skills/tree/e8a175de22ae1e49370fc144c1f3bb9aeedf988d/skills)                                                                                                                                                                                                                                                                                | Realistic layout stress, interruptible motion and mobile checks; no fixed variant picker or audit fan-out. Performance caveats checked against [Motion docs](https://motion.dev/docs/performance) |
| [Dillon Mulroy's skills](https://github.com/dmmulroy/skills/tree/8603380821fee6a77c82639f364ce8fe4f5a92be) and [anti-slop](https://github.com/dmmulroy/anti-slop/tree/c44ef22ca116d0ba62a3ff663a0bd13a3f3fa40b)                                                                                                                                                                                      | Reviewed Effect/error and cleanup approaches; retain our own service layout and ownership                                                                                                         |
| [Interface Craft](https://www.interfacecraft.dev/library), the user's licensed library                                                                                                                                                                                                                                                                                                               | Before-the-first-draft steps, range and depth, agent-run tuning, the four-pass critique, optical, color, type and motion values; ideas adapted in our words, no files copied                      |
| [Apple HIG](https://developer.apple.com/design/human-interface-guidelines), [Linear](https://linear.app/now/how-we-redesigned-the-linear-ui), [Rauno Freiberg](https://rauno.me/craft/interaction-design), [Geist](https://vercel.com/geist), [Radix](https://www.radix-ui.com/primitives/docs/overview/accessibility) and [WCAG](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) | The quality bar, platform conventions, semantic type and glass, gesture behavior, border and shadow roles, dialog contracts and contrast ratios                                                   |

Additional sources for this refinement:

- [OpenClaw test audit](https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md): distinct regression protection and deletion of tautological tests; retain independent boundary contracts.
- [Trail of Bits](https://github.com/trailofbits/skills): reproduce the strongest reachable counterexample and inspect variants of a known root cause; no routine security-audit machinery.
- [Bret Victor](https://worrydream.com/ExplorableExplanations/) and [Nicky Case](https://blog.ncase.me/how-i-make-an-explorable-explanation/): concrete cause and consequence, with optional exploration rather than mandatory navigation.
- [Taste skill](https://github.com/Leonxlnx/taste-skill/tree/a60a36dc2bb3bb77ccf17f2f62041f5ca8a458b9): real subject inventory and screenshot critique; no mandatory image, motion or component quotas.
- [Anatomy](https://github.com/wheresryan22/anatomy): physical and isometric explanations when their relationships are the concept; no mandatory dense machine or separate card frame.
- [Antfu design](https://github.com/antfu/design): native token hierarchy, density and affordance; no Vue or UnoCSS dependency added.
- [Animated sprites](https://github.com/elithrar/dotfiles/tree/main/.agents/skills/animated-sprites): separate structural validity from perceptual motion and actual timing; no character assets required.
- [pstack correct](https://github.com/cursor/plugins/blob/e5136d82418d2db3165ea1050d17577cd618cc05/pstack/skills/correct/SKILL.md), [caller migration](https://github.com/cursor/plugins/blob/e5136d82418d2db3165ea1050d17577cd618cc05/pstack/skills/principle-migrate-callers-then-delete-legacy-apis/SKILL.md) and [design red flags](https://github.com/cursor/plugins/blob/e5136d82418d2db3165ea1050d17577cd618cc05/pstack/skills/architect/references/design-red-flags.md): engineering's Patterns, with a canonical example per shape, whole-repository pattern changes and enforcement of repeated corrections above prose; no rule table beside the Patterns rows, no expiry dates on exceptions.

These are selectively adapted ideas, not imported frameworks. Concrete behavior, existing stack and settled user decisions govern the maintained skills. Source inspection and drafted evaluation criteria do not establish a model-quality improvement.

</details>
