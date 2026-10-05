---
name: environment
description: 'Machine facts and repository commands. Use for host setup, local entrypoints or skill installation; repository-specific details are in the relevant reference.'
---

# Environment

**Host.** The development machine serves phone and Mac clients through Tailscale; SSH uses keys. T3 owns worktree setup and managed harness updates.

## Machine

- **Tools.** `~/.vite-plus/bin` supplies Node and package-manager shims: `vp` for packages, `vpx` for binaries. Passwordless sudo; gh and glab use existing sign-ins.
- **Scratch.** Logs and command output: `node_modules/.cache/deslop/`. Cloned upstream sources: `~/.deslop/repos/`.
- **T3 state.** Prefer app-owned thread tools. For local read-only inspection, verify the database opened by the running `t3 serve` process before setting `T3_DB`; this machine currently uses `~/.t3/userdata/statev2.sqlite`. Live thread, run and session data is in `orchestration_v2_projection_*`. Legacy `projection_*` and `provider_session_runtime` can remain stale even in the live database. Use `sqlite3 -readonly` and select needed fields, not raw payloads or credentials.
- **Services.** Temporary containers, not host installations. Maintenance owns Docker binding defaults; preserve unrelated workloads.
- **Exposure.** Requested previews use Tailscale Serve through workflow's Browser procedure. Share the verified tailnet HTTPS URL, not localhost; keep only requested previews running.

## Repositories

Use [Deslop](references/deslop.md) or [Dual](references/dual.md) from that repository's root. Discover inventories and versions from source when needed, not from cached prose.

## Repository skills and incremental refactors

**Refresh.** Follow the owning package brief for which files are sources and which are copies. Refresh only when installing or updating skills, not every session:

```bash
vpx @deslop/coding-standards@latest --help
vpx @deslop/coding-standards@latest
```

**Missing copies.** If engineering, design or testing is missing from a worktree, run the installer before code work.

**Versions.** Skill refresh changes no manifest or lockfile. Upgrade presets only in touched packages; versions may differ. The primary agent batches shared lockfile and install changes and verifies frozen installation. Deslop uses workspace source.

- **Substantial.** Bring the whole handwritten package under full shared rules; remove exclusions and downgrades. Judge structural reach, not generated churn or arbitrary percentages.
- **Small.** Full rules for changed code; restore severity to inventory diagnostics, remove empty exclusions, retain only untouched legacy violations. No new exclusions.
- **Generated.** Keep generated and build-output ignores; restore full shared configuration, not severity alone. Run the root check and fix.

**Standards.** Remove overlap from the changed repository's CODING_STANDARDS.md; keep layout and tooling, stricter local choices and domain contracts. Resolve contradictions at their source.
