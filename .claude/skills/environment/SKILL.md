---
name: environment
description: 'Machine facts, repository commands, previews, agent configuration installation and media extraction. Use it for the tailnet, repository commands, previews, coding-standards setup or installing Claude and Codex configuration on both workers. Also use it to set up, update, clean or redeploy a machine, or to analyze a shared video or post.'
---

# Environment

Agents run on two headless Debian workers in one tailnet, and the user switches between them. Both have the same paths and user, so a path never identifies the worker. A session-start hook in both harnesses puts `Execution worker: <name>` in context; without it, `hostname -s` names the current one. Check it before a machine-specific step, and run commands for the other worker through SSH. T3 sets up worktrees and updates itself, Codex and Claude Code.

## Tailnet

MagicDNS resolves short names, and `<name>.tailnet-8c4c.ts.net` has HTTPS certificates.

| Name          | Address          | Role                                                                                                    |
| ------------- | ---------------- | ------------------------------------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Home worker for most development, on only when the user turns it on                                     |
| `dev`         | `100.68.201.107` | Always-on worker with a public address: Traefik for `*.mp281x.xyz`, VPN, Jaeger, long or overnight work |
| `macbook-pro` | `100.115.207.60` | The user's control plane and the iOS Simulator [device host](references/maintenance.md#mac), on demand  |
| `iphone`      | `100.117.217.10` | The user's phone, a T3 client only                                                                      |

- **SSH.** Every machine reaches every other, itself included, as `mp281x@dev`, `mp281x@desktop` and `matteopaludgnach@macbook-pro`. Copy files with `rsync -a`.
- **GitLab.** `git.datapizza.tech` works only through dev's VPN route, so an expired VPN breaks GitLab on every machine. Reconnect it on dev per [Dual](references/dual.md).
- **Dev tasks.** Run public-app and VPN tasks on `dev` through SSH.

## References

| Reference                                | Use it for                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Commands, app, tracing and coding standards                             |
| [Dual](references/dual.md)               | Commands, VPN, preview, accounts, CI, tracing and coding standards      |
| [Maintenance](references/maintenance.md) | Machine facts, access, agent configuration, updates, cleaning and setup |
| [Media](references/media.md)             | Transcripts and post text from YouTube, X, TikTok and similar           |

Run repository commands from the repository root. Read inventories and versions from source, not from prose.

## Machine state

- **Tools.** Vite+ supplies `vp` for packages and `vpx` for binaries. Both are on `PATH` in every shell, including `ssh <worker> '<command>'`; systemd units need the absolute `~/.vite-plus/bin` path. Sudo needs no password, and `gh` and `glab` are signed in.
- **Scratch.** Put every scratch file under `/tmp/<task>/`. `/tmp` is on disk, empties at boot and drops files unused for 7 days.
- **Git refs.** T3 keeps a checkpoint commit per turn under `refs/t3/`. Search history with `--branches --remotes`, or with `--exclude='refs/t3/*' --all`.
- **Services.** Run services as temporary containers, not host installations. Preserve unrelated workloads.

## Previews

- **Build.** Run the repository's documented preview command, which the repository references name; testing's Final proof decides what it proves. Never invent a production-preview command, and keep development servers for work that requires them.
- **Start.** Each worktree has one preview: the systemd user unit `preview-<worktree name>`, which survives a T3 restart, shared on the tailnet over HTTPS. The project's `preview`, `stop` and `settle` scripts in [maintenance's Project scripts](references/maintenance.md#t3-settings) own it; the user runs the same scripts from T3's script menu. To start it, run the project's `preview` command from the worktree root: it replaces a running preview and prints the HTTPS URL, which stays the same across restarts.
- **Share.** The first request waits for a certificate. Verify sign-in, assets and API calls through the printed URL before you share it. Open it in the one T3 tab that you share with the user, per delivery's captures.
- **Public webhooks.** Funnel exposes a whole port, so give the webhook path its own port: an unused one among 443, 8443 and 10000 in `sudo tailscale serve status --json`. Run `sudo tailscale funnel --bg --https=<funnel port> --set-path <path> http://127.0.0.1:<api port><path>`, and verify that the sign-in path does not answer there. Stop it with `sudo tailscale funnel --https=<funnel port> --set-path <path> off`.
- **Restart.** Run the `preview` command again after a change that the preview does not reload, also after a build that deletes its files.
- **Keep.** At the end of every turn, also after delivery, leave the preview running on the latest code with its HTTPS link and the T3 tab. Never stop it at handoff or wait for the user to ask for it again.
- **Stop.** The `stop` command stops the unit and removes its Tailscale mapping. Run it only when the user asks. Never stop a listener you did not start.
- **Settle.** T3 runs the `settle` command when the user settles a thread with its own worktree or its pull request merges. It stops the preview and runs the project's cleanup.

## Diagnostics

- **Rerenders.** Count with React Profiler or temporary `console.count` through `preview_evaluate`; remove the probe before push. Normal-build commit counts are not CPU timings; use a profiling build for timing.
- **Slow input.** Use `performance.mark` and a `PerformanceObserver` for `longtask` and `event` entries through `preview_evaluate`.
- **Tracing.** Use the [Deslop](references/deslop.md#application-tracing) or [Dual](references/dual.md) endpoints. Correlate one real action's client and server spans, hierarchy, errors and duration before and after the fix. Missing spans prove neither coverage nor speed.
