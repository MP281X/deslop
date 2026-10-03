---
name: environment
description: 'Machine facts, repository entrypoints and local coding-skill setup.'
---

# Environment

**Host.** The development machine serves phone/Mac clients through Tailscale; SSH uses keys. T3 owns worktree setup and managed harness updates.

## Machine

- **Tools.** `~/.vite-plus/bin` supplies Node/package-manager shims: `vp` for packages, `vpx` for binaries. Passwordless sudo; gh/glab use existing sign-ins.
- **Scratch.** `node_modules/.cache/deslop/`; cloned upstream sources: `~/.deslop/repos/`.
- **Services.** Temporary containers, not host installations. Maintenance owns Docker binding defaults; preserve unrelated workloads.
- **Exposure.** Requested previews use Tailscale Serve through workflow's Browser procedure. Share the verified tailnet HTTPS URL, not localhost; keep only requested previews running.

## Repositories

Use [Deslop](references/deslop.md) or [Dual](references/dual.md) from that repository's root. Discover inventories/versions from source when needed, not from cached prose.

## Repository skills and incremental refactors

**Copies.** Commit CLI-generated engineering/design/testing so fresh checkouts have them. Treat them as read-only; change upstream skill source, not copies. Refresh only when installing/updating skills, not every session:

```bash
vpx @deslop/coding-standards@latest --help
vpx @deslop/coding-standards@latest
```

**Versions.** Skill refresh changes no manifests/lock. Upgrade presets only in touched packages; versions may differ. The pair batches shared lock/install changes and verifies frozen installation. Deslop uses workspace source.

- **Substantial.** Bring the whole handwritten package under full shared rules; remove exclusions/downgrades. Judge structural reach, not generated churn or arbitrary percentages.
- **Small.** Full rules for changed code; restore severity to inventory diagnostics, remove empty exclusions, retain only untouched legacy violations. No new exclusions.
- **Generated.** Keep generated/build-output ignores; restore full shared configuration, not severity alone. Run root checks/fixes.

**Standards.** Remove overlap from the changed repository's CODING_STANDARDS.md; keep layout/tooling, stricter local choices and domain contracts. Resolve contradictions at their source.
