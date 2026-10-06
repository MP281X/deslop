---
name: environment
description: 'Machine facts and repository commands. Use for host setup, local entrypoints, T3 state, source checkouts or skill installation; repository details are in the relevant reference.'
---

# Environment

The development machine serves phone and Mac clients through Tailscale; SSH uses keys. T3 owns worktree setup and harness updates.

## Machine

- **Tools.** `~/.vite-plus/bin` supplies Node and package-manager shims: `vp` for packages, `vpx` for binaries. Sudo needs no password; `gh` and `glab` use existing sign-ins.
- **Scratch.** Logs and command output go to `node_modules/.cache/deslop/`.
- **Services.** Run them as temporary containers, not host installations. Maintenance owns Docker binding defaults; preserve unrelated workloads.
- **Previews.** Requested previews use Tailscale Serve through workflow's Browser procedure; share the tailnet HTTPS URL, not localhost.

## Source checkouts

Read dependencies in a checkout of the official repository at the version the manifest or lockfile consumes, or a matching vendored or shared checkout; check its remote and commit before citing it. Shared checkouts are read-only and need no install or build.

```bash
git clone --depth 1 --branch <version-tag> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

## T3 state

Prefer T3's thread tools. For read-only local inspection, use the database the running `t3 serve` process opened, currently `~/.t3/userdata/statev2.sqlite`, with `sqlite3 -readonly`, selecting only the fields you need (never credentials). Live threads, runs, subagents and turn items are in `orchestration_v2_projection_*`; legacy `projection_*` tables can be stale.

To recover a thread's native transcripts, find its provider sessions, then the session files:

```bash
sqlite3 -readonly -header -column ~/.t3/userdata/statev2.sqlite "SELECT provider_thread_id, provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
find "$HOME/.codex/sessions" "$HOME/.claude/projects" -type f -name "*<session id>.jsonl"
```

Pick the session that covers the run in question; the latest may not include stopped or replaced runs. Claude subagents sit in `<session>/subagents/`. A Codex child's first `session_meta` record names its parent in `payload.parent_thread_id`. A `compacted` record marks a compaction, not a task boundary.

## Repositories

Use the [Deslop](references/deslop.md) or [Dual](references/dual.md) reference from that repository's root. Discover inventories and versions from source, not from cached prose.

## Coding standards

- **Skills.** Engineering, design and testing copies come from `vpx @deslop/coding-standards@latest`; run it when installing or updating them, or when a worktree lacks them before code work. It changes no manifest or lockfile.
- **Lint migration.** A package adopts the `@deslop/coding-standards` preset only when the branch makes feature changes in it. Files the branch adds pass the full rules; existing files stay on the package's legacy warning list, and their code is not rewritten only to satisfy new rules. Keep generated and build-output ignores.
- **Installs.** The primary agent batches manifest, lockfile and install changes and verifies a frozen install.
- **Standards file.** Remove from the repository's `CODING_STANDARDS.md` what the shared skills already say; keep layout, tooling, stricter local choices and domain contracts.
