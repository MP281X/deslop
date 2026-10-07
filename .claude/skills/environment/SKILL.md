---
name: environment
description: 'Machine facts, repository commands, machine upkeep and media extraction. Use it for host setup, local entrypoints, T3 state, source checkouts or skills. Also use it to update, clean or redeploy the machine, or to analyze a shared video or post.'
---

# Environment

The user works on two headless Debian 13 machines through T3, from a Mac and a phone over Tailscale. SSH uses keys. T3 owns worktree setup and harness updates. Run `hostname` to learn which machine runs you.

| Machine   | Role                                                                       | Hardware                    |
| --------- | -------------------------------------------------------------------------- | --------------------------- |
| `dev`     | Always-on VPS with the production containers, the Datapizza VPN and Jaeger | 8 cores, 23 GB              |
| `desktop` | Home workstation for heavy work, with no public services                   | 24 threads, 30 GB, RTX 5070 |

| Reference                                | Use it for                                                    |
| ---------------------------------------- | ------------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Commands, app, tracing and installing personal configuration  |
| [Dual](references/dual.md)               | Commands, VPN, preview, CI and tracing                        |
| [Desktop](references/desktop.md)         | Access, toolchain, GPU, wake-on-LAN and rebuild of `desktop`  |
| [Maintenance](references/maintenance.md) | Updating, deploying and cleaning the machines                 |
| [Media](references/media.md)             | Transcripts and post text from YouTube, X, TikTok and similar |

Run repository commands from the repository root. Discover inventories and versions from source, not from cached prose.

## Machine

- **Tools.** The Vite+ shims are `vp` for packages and `vpx` for binaries. They live in `~/.vite-plus/bin` on dev and in `~/.local/share/vite-plus/bin` on `desktop`. Login shells have them on `PATH`, but systemd units need the absolute path. Sudo needs no password, and `gh` and `glab` use existing sign-ins.
- **Scratch.** Logs and command output go to `node_modules/.cache/deslop/`.
- **Services.** Run services as temporary containers, not host installations. Maintenance owns the Docker binding defaults; preserve unrelated workloads.
- **Heavy commands.** Type checks, builds and test suites of every repository take one machine-wide lock at lower priority: `flock "$HOME/.deslop/heavy.lock" nice -n 10 <command>`. Two at once fill memory and make T3 disconnect.

## Previews

- **Start.** Run the repository's preview command detached, so it survives a T3 restart: `systemd-run --user --unit=<repository>-preview-<worktree> --working-directory=<worktree> <command>`. Bind it to `127.0.0.1` on a free port (`ss -ltn`).
- **Share.** Expose it with `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`, and get the host from `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. The first request waits for a certificate. Verify sign-in, assets and API calls through `https://<host>:<port>` from the tailnet before you share it, never a localhost URL.
- **Public webhooks.** Funnel makes a whole port public, so give the webhook path its own port. Check `sudo tailscale serve status --json`, then pick an unused port among 443, 8443 and 10000; 8443 already serves another app. Run `sudo tailscale funnel --bg --https=<funnel port> --set-path <path> http://127.0.0.1:<api port><path>`, and verify that the sign-in path does not answer there. Stop it with `sudo tailscale funnel --https=<funnel port> --set-path <path> off`.
- **Restart.** A stopped `systemd-run` unit disappears, so `systemctl --user start` cannot bring it back. Use `systemctl --user restart <unit>` while it runs; after a stop, run the same `systemd-run` command again.
- **Keep or stop.** Restart a preview in place after a build that deletes its files. Keep one preview per branch while the user uses it; otherwise run `sudo tailscale serve --https=<port> off` and `systemctl --user stop <unit>`. A listener you did not start is not yours to stop.

## External accounts

- **Read-only by default.** Read any account the user connected. Write only where the user allowed it, on scratch resources you create, named `<repository>-test-<yyyymmdd>`, private, and in the user's personal namespace.
- **Afterwards.** Delete each resource you recorded, after checking its name and namespace again, and verify that none remain. Remove only the connections you created that hold write tokens.
- **Tokens.** Read a token inside the command that uses it, never print it, and never write it into a file, log or body. When the user must configure a provider, give a numbered guide and ask for screenshots of results you cannot see.

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
