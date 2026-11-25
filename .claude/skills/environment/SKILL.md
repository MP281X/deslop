---
name: environment
description: Load before a command on another worker, starting a preview, opening a device, reading a trace or runtime error, deploying, publishing, a sign-in, reading Stash data, reading an outside repository or a package's source, a maintenance pass, or any Dual task.
---

# Environment

A headless Debian worker, a MacBook and an iPhone Duo in one tailnet.

| Name          | Address          | Role                                                                               |
| ------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `ikoula`      | TBD              | The only worker (Ryzen 7 9700X, 64 GB): agents, previews, fix, check and test      |
| `dev`         | `100.68.201.107` | Being retired: Deslop apps for `*.mp281x.xyz` until its reset                      |
| `macbook-pro` | `100.115.207.60` | The iOS Simulator and a Deploy worker, on demand; sometimes the control plane      |
| `iphone-duo`  | `100.69.97.49`   | The main control plane: T3 on the inner screen, held upright and sometimes rotated |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@ikoula`, `mp281x@dev`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` on `PATH`, also over SSH; `gh`, `glab` and the MCP gateway signed in.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Checks.** Fix, check and test run on the worker, unthrottled, before each push; CI only confirms. T3 already gives agents a low CPU weight.
- **Auxiliary services.** Run task-local ones as temporary containers, not installs on the worker.
- **Agent MCP.** [Keyring and MCP](references/maintenance.md#keyring-and-mcp).

| Reference                                    | For                                                      |
| -------------------------------------------- | -------------------------------------------------------- |
| [Deslop](references/deslop.md)               | Production, Stash data, npm, Apple and EAS, tracing      |
| [Dual](references/dual.md)                   | Accounts, AWS, Jira, Google, VPN, preview, tracing       |
| [Maintenance](references/maintenance.md)     | Workers, setup, agent links, T3 settings, updates, clean |
| [Repositories](references/repos.md)          | The packages we use and reference repositories           |
| [Pull requests](references/pull-requests.md) | Drafts, stacks, GitHub and GitLab stack commands         |

## Previews

One per worktree: the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS.

- **Script.** When a capture needs it, start the preview from the worktree root and give its HTTPS URL once it answers. Deslop's is `vp run preview [app]`, by default the first app with a web page (`index.html`) the branch changes, else Portfolio; an iOS app's server, such as Stash's, starts only by name. It prints the URL only once that URL's `/api/runtime` names the app; it fails at once when another checkout or server holds its port, and with the unit's last log lines when the unit stops or five minutes pass, stopping what it started. `vp run preview:stop` ends it. Elsewhere, run the project's preview script (read it with `t3_project_read`); Dual's is its [prod-like preview](references/dual.md#preview). An app's own `preview` script or a background task bypasses the unit and dies with the turn.
- **Webhooks.** Never open a Funnel or another public route for a preview, since it puts the whole port on the internet; when a proof needs a real webhook delivery, say that it is blocked.

## Tools

| Question                        | Tool                                                                                                                              |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Runtime state                   | Deploy's `list_apps` or `read_resource_history`, with the short worker name (`dev`); host checks follow the maintenance reference |
| Runtime error, trace or latency | Scope's `list_operations`, then `search_traces`, then `read_trace` or `measure_latency`                                           |
