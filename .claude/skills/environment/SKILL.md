---
name: environment
description: 'Machine facts, repository commands, previews, machine upkeep and media extraction. Use it for the tailnet, repository commands, previews or coding-standards setup. Also use it to set up, update, clean or redeploy a machine, or to analyze a shared video or post.'
---

# Environment

Agents run on two headless Debian workers in one tailnet; `hostname -s` tells you which. Most development happens on `desktop`, which the user turns on when needed. T3 owns worktree setup and updates itself, Codex and Claude Code.

## Tailnet

MagicDNS resolves each short name, and `<name>.tailnet-8c4c.ts.net` gives HTTPS certificates.

| Name               | Address          | Role                                                                                                                        |
| ------------------ | ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `desktop`          | `100.97.120.3`   | Home worker for most development and GPU work, on only when the user turns it on                                            |
| `dev`              | `100.68.201.107` | Always-on worker with a public address: Traefik serves every `*.mp281x.xyz`, VPN, Jaeger; also long or overnight agent work |
| `macbook-pro`      | `100.115.207.60` | The user's control plane, often asleep; agents never set it up or develop on it                                             |
| `iphone`           | `100.117.217.10` | The user's phone; a T3 client only                                                                                          |
| `*.mullvad.ts.net` | Exit nodes       | Location exits for [Media](references/media.md); never set one for other traffic                                            |

- **SSH.** Any machine reaches any other, itself included, as `mp281x@dev`, `mp281x@desktop` and `matteopaludgnach@macbook-pro`; maintenance owns the keys. Copy files with `rsync -a <path> <user>@<name>:<path>`.
- **Paths.** `dev` and `desktop` connect directly over UDP in about 40 ms. `tailscale ping <name>` shows whether a path is direct or relayed.
- **GitLab.** `git.datapizza.tech` works only through dev's VPN. Every other machine uses the route that dev advertises, so an expired VPN breaks GitLab on every machine; reconnect it on dev per [Dual](references/dual.md).
- **Work on the other worker.** Run public-app and VPN tasks on `dev` through SSH. Run GPU work on `desktop`.

## References

| Reference                                | Use it for                                                              |
| ---------------------------------------- | ----------------------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Commands, app, tracing and coding standards                             |
| [Dual](references/dual.md)               | Commands, VPN, preview, accounts, CI, tracing and coding standards      |
| [Maintenance](references/maintenance.md) | Machine facts, access, agent configuration, updates, cleaning and setup |
| [Media](references/media.md)             | Transcripts and post text from YouTube, X, TikTok and similar           |

Run repository commands from the repository root. Discover inventories and versions from source, not from cached prose.

## Machine state

- **Tools.** Vite+ in `~/.vite-plus/bin` supplies `vp` for packages and `vpx` for binaries. Every shell has it on `PATH`, including `ssh <worker> '<command>'`; systemd units need the absolute path. Sudo needs no password, and `gh` and `glab` use existing sign-ins.
- **Scratch.** Every scratch file goes under `/tmp/<task>/`: logs, command output, captures, eval copies and repository clones. `/tmp` is on disk, empties at boot and drops files unused for 7 days, so keep nothing there that must last.
- **Git refs.** T3 keeps a checkpoint commit per turn under `refs/t3/`, which more than doubles the commits that `--all` walks. Search history with `--branches --remotes`, or add `--exclude='refs/t3/*'` before `--all`.
- **Services.** Run services as temporary containers, not host installations. Maintenance owns the Docker binding defaults; preserve unrelated workloads.

## Previews

- **Build.** Release proof uses the production build served through the tailnet HTTPS URL. A development server differs in bundling and network behavior, so it proves only iteration. A repository reference names its preview when it has no production one.
- **Start.** Run the repository's preview command detached, so it survives a T3 restart: `systemd-run --user --unit=<repository>-preview-<worktree> --working-directory=<worktree> <command>`. Bind it to `127.0.0.1` on a free port (`ss -ltn`).
- **Share.** Expose it with `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`, and get the host from `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. The first request waits for a certificate. Verify sign-in, assets and API calls through `https://<host>:<port>` from the tailnet before you share it, never a localhost URL.
- **Public webhooks.** Funnel makes a whole port public, so give the webhook path its own port. Check `sudo tailscale serve status --json`, then pick an unused port among 443, 8443 and 10000. Run `sudo tailscale funnel --bg --https=<funnel port> --set-path <path> http://127.0.0.1:<api port><path>`, and verify that the sign-in path does not answer there. Stop it with `sudo tailscale funnel --https=<funnel port> --set-path <path> off`.
- **Restart.** A stopped `systemd-run` unit disappears, so `systemctl --user start` cannot bring it back; a failed one stays until `systemctl --user reset-failed <unit>`. Use `systemctl --user restart <unit>` while it runs; after a stop, run the same `systemd-run` command again.
- **Keep or stop.** Restart a preview in place after a build that deletes its files. Keep the thread's preview until the user says to stop it or its pull requests merge; then run `sudo tailscale serve --https=<port> off` and `systemctl --user stop <unit>`. A listener you did not start is not yours to stop.
