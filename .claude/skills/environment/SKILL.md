---
name: environment
description: 'Machine facts, repository commands, machine upkeep and media extraction. Use it for host setup, local entrypoints, T3 state, source checkouts or skills. Also use it to update, clean or redeploy the machine, or to analyze a shared video or post.'
---

# Environment

The development machine serves phone and Mac clients through Tailscale, and SSH uses keys. T3 owns worktree setup and harness updates.

| Reference                                | Use it for                                                    |
| ---------------------------------------- | ------------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Commands, app, tracing and installing personal configuration  |
| [Dual](references/dual.md)               | Commands, VPN, preview, CI and tracing                        |
| [Maintenance](references/maintenance.md) | Updating, deploying and cleaning the machine                  |
| [Media](references/media.md)             | Transcripts and post text from YouTube, X, TikTok and similar |

Run repository commands from the repository root. Discover inventories and versions from source, not from cached prose.

## Machine

- **Tools.** `~/.vite-plus/bin` supplies the Node and package-manager shims: `vp` for packages and `vpx` for binaries. Sudo needs no password, and `gh` and `glab` use existing sign-ins.
- **Scratch.** Logs and command output go to `node_modules/.cache/deslop/`.
- **Services.** Run services as temporary containers, not host installations. Maintenance owns the Docker binding defaults; preserve unrelated workloads.
- **Previews.** Requested previews use Tailscale Serve through workflow's Browser procedure. Share the verified tailnet HTTPS URL, not localhost.

## Source checkouts

Read a dependency in a checkout of its official repository at the version the manifest or lockfile uses. A matching vendored or shared checkout also works; check its remote and commit before you cite it. Shared checkouts are read-only and need no install or build.

```bash
git clone --depth 1 --branch <version-tag-or-required-branch> <official-repository-url> "$HOME/.deslop/repos/<repository>-<version>"
```

## T3 state

Prefer T3's thread tools. For read-only local inspection, verify which database the running `t3 serve` process opened, and set `T3_DB` to it. On this machine it is currently `~/.t3/userdata/statev2.sqlite`. Query it with `sqlite3 -readonly`, and select only the fields you need; never read raw payloads or credentials. Live threads, runs, subagents and turn items are in `orchestration_v2_projection_*`. Legacy `projection_*` tables and `provider_session_runtime` can be stale.

To recover a thread's native transcripts, find its provider sessions, then the session files:

```bash
sqlite3 -readonly -header -column "$T3_DB" "SELECT provider_thread_id, provider, status, json_extract(payload_json, '$.nativeThreadRef.nativeId') AS session_id, updated_at FROM orchestration_v2_projection_provider_threads WHERE thread_id = '<thread id>' ORDER BY updated_at DESC;"
S='<selected session id>'; : "${S:?No session selected}"
find "$HOME/.codex/sessions" "$HOME/.claude/projects" -type f -name "*$S.jsonl"
```

- **Session choice.** Pick the session that covers the run in question; the latest one can miss stopped or replaced runs.
- **Subagents.** Claude subagents sit in `<session>/subagents/`. A Codex child's first `session_meta` record names its parent in `payload.parent_thread_id`. Messages forked from the parent are not new work.
- **Compaction.** A `compacted` record marks a compaction, not a task boundary.

## Coding standards

- **Skills.** The engineering, design and testing copies come from `vpx @deslop/coding-standards@latest`. Run it when you install or update them, or when a worktree lacks them before code work. It changes no manifest or lockfile.
- **Lint migration.** A package adopts the `@deslop/coding-standards` preset only when the task changes its code. Formatter and lint-only edits do not count.
- **Changed code.** Files the task adds and code the task changes pass the full rules. A substantial refactor brings the whole package under the full rules.
- **Untouched code.** Untouched code keeps the package's legacy warning list. Do not rewrite it only to satisfy the new rules. Keep the ignores for generated and build output.
- **Installs.** The primary agent batches manifest, lockfile and install changes, and verifies a frozen install.
- **Standards file.** Remove from the repository's `CODING_STANDARDS.md` what the shared skills already say. Keep the layout, tooling, stricter local choices and domain contracts.
