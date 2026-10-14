---
name: environment
description: 'Machine facts, repository commands, previews, agent configuration installation and media extraction. Use it for the tailnet, repository commands, previews, coding-standards setup or installing Claude and Codex configuration on both workers. Also use it to set up, update, clean or redeploy a machine, or to analyze a shared video or post.'
---

# Environment

Agents run on two headless Debian workers in one tailnet; `hostname -s` names the current one. Most development runs on `desktop`, which the user turns on when needed. T3 sets up worktrees and updates itself, Codex and Claude Code.

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

- **Build.** Prefer the repository's actual built preview for browser testing and recording. Use its documented command and share it through tailnet HTTPS. A preview command that runs development watchers proves iteration only; do not invent a production-preview command or relabel that evidence. Keep development servers for work that requires them, not as a second default proof environment.
- **Start.** Run the preview command detached, so it survives a T3 restart: `systemd-run --user --unit=<repository>-preview-<worktree> --working-directory=<worktree> <command>`. Bind it to `127.0.0.1` on a free port (`ss -ltn`).
- **Share.** Run `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`; the host is `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. The first request waits for a certificate. Verify sign-in, assets and API calls through `https://<host>:<port>` before you share it. Use the same visible browser tab for testing, recording and handoff; keep it open with its preview service and HTTPS link.
- **Public webhooks.** Funnel exposes a whole port, so give the webhook path its own port: an unused one among 443, 8443 and 10000 in `sudo tailscale serve status --json`. Run `sudo tailscale funnel --bg --https=<funnel port> --set-path <path> http://127.0.0.1:<api port><path>`, and verify that the sign-in path does not answer there. Stop it with `sudo tailscale funnel --https=<funnel port> --set-path <path> off`.
- **Restart.** Run `systemctl --user restart <unit>` while the unit runs, also after a build that deletes the preview's files. A stopped unit disappears, so run the same `systemd-run` again. A failed unit stays until `systemctl --user reset-failed <unit>`.
- **Stop.** Keep the thread's preview until the user says to stop it or its pull requests merge. Then run `sudo tailscale serve --https=<port> off` and `systemctl --user stop <unit>`. Never stop a listener you did not start.

## Diagnostics

- **Rerenders.** Count with React Profiler or temporary `console.count` through `preview_evaluate`; remove the probe before push. Normal-build commit counts are not CPU timings; use a profiling build for timing.
- **Slow input.** Use `performance.mark` and a `PerformanceObserver` for `longtask` and `event` entries through `preview_evaluate`.
- **Tracing.** Use the [Deslop](references/deslop.md#application-tracing) or [Dual](references/dual.md) endpoints. Correlate one real action's client and server spans, hierarchy, errors and duration before and after the fix. Missing spans prove neither coverage nor speed.
