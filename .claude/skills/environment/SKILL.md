---
name: environment
description: 'Machine facts, repository entrypoints and local coding-skill setup.'
---

# Environment

`mp281x@dev` is the always-on development host; the phone and MacBook are clients. SSH uses Tailscale and keys. Initialize new worktrees with `vp install`; reuse initialized dependencies.

## Machine

- Debian 13, 8 CPUs, 23G RAM; passwordless `sudo`. Only traefik's 80/443 are internet-accessible; SSH and other listeners use the tailnet.
- `~/.vite-plus/bin` supplies Node and package-manager shims: packages use `vp`, binaries `vpx`. Docker, agent-browser, gh (MP281X), glab (git.datapizza.tech) and Tailscale are installed.
- Scratch/logs/media: `node_modules/.cache/deslop/`; upstream source cache: `~/.deslop/repos/`.
- Task services use temporary containers, not host installations; publish on `127.0.0.1` because Docker bypasses the firewall.

## Repositories

Read only the target repository's reference: [Deslop](references/deslop.md) or [Dual](references/dual.md). Browser, check/publishing, research and upkeep commands live in their corresponding procedures.

## Repository skills and incremental refactors

Run the latest @deslop/coding-standards CLI transiently to install or refresh engineering/design/testing, without adding a dependency. It finds the Git root even from a nested directory and replaces those names under existing native folders; none present → `.agents` only. No global skills or unrelated changes:

```bash
vpx @deslop/coding-standards@latest --help
vpx @deslop/coding-standards@latest
```

Skill refreshes do not change package manifests or the lockfile. Consumer packages can retain different preset versions; upgrade only touched packages from their package directories, not unrelated packages/dependencies. Deslop uses workspace source. The pair owns shared lockfile/install: batch touched-package updates and validate resolved versions together.

- Substantial handwritten-package changes remove local exclusions/downgrades (warnings, overrides, inline suppressions) and bring the whole handwritten package under full shared rules. Judge proportion/structural reach, not generated churn or a fixed percentage.
- Small changes meet full rules in new/changed code. Restore shared severity to inventory diagnostics; remove exclusions with no remaining scoped violation, retaining only those required by untouched legacy code. Never add exclusions for new code.
- Keep generated/build-output ignores; restore full shared-rule configuration, not severity alone. Verify package checks and frozen-lockfile install.

In the changed repository only, remove reusable skill rules duplicated in CODING_STANDARDS.md; keep concrete layout/tooling, stricter local choices and domain contracts. Resolve contradictions at their source, not through another exception.
