---
name: environment
description: Load before a command on another worker, starting a preview, opening a device, reading a trace or runtime error, deploying, publishing, a sign-in, reading Stash data, reading an outside repository or a package's source, a maintenance pass, or any Dual task.
---

# Environment

| Name          | Address          | Role                                                                               |
| ------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `ikoula`      | TBD              | The only Debian worker (Ryzen 7 9700X, 64 GB): agents, previews, fix, check, test  |
| `dev`         | `100.68.201.107` | Being retired: Deslop apps for `*.mp281x.xyz` until its reset                      |
| `macbook-pro` | `100.115.207.60` | The iOS Simulator and a Deploy worker, on demand; sometimes the control plane      |
| `iphone-duo`  | `100.69.97.49`   | The main control plane: T3 on the inner screen, held upright and sometimes rotated |

- **Names.** Tailnet short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@ikoula`, `mp281x@dev`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp`, `vpx`, `gh`, `glab` and the MCP gateway are installed and signed in, also over SSH.
- **Git refs.** T3 checkpoints live under `refs/t3/`; search history with `--branches --remotes`.
- **Checks.** Fix, check and test run on the worker, unthrottled, before each push; CI only confirms.
- **Auxiliary services** a task needs run as temporary containers, not installs.

| Reference                                    | For                                                      |
| -------------------------------------------- | -------------------------------------------------------- |
| [Deslop](references/deslop.md)               | Production, Stash data, npm, Apple and EAS, tracing      |
| [Dual](references/dual.md)                   | Accounts, AWS, Jira, Google, VPN, preview, tracing       |
| [Maintenance](references/maintenance.md)     | Workers, setup, agent links, T3 settings, updates, clean |
| [Repositories](references/repos.md)          | The packages we use and reference repositories           |
| [Pull requests](references/pull-requests.md) | Drafts, stacks, GitHub and GitLab stack commands         |

## Previews

Start one only when a capture needs it, from the worktree root, through the project's `preview` script (`t3_project_read`): Deslop's `vp run preview [app]` and `vp run preview:stop`; Dual's [prod-like preview](references/dual.md#preview). Give the user the URL it prints. An app's own `preview` script or a background task dies with the turn.

Never open a Funnel or another public route for a preview: it puts the whole port on the internet. When a proof needs a real webhook delivery, tell the user it is blocked.

## Tools

| Question                        | Tool                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Runtime state                   | Deploy's `list_apps` or `read_resource_history`, with the short worker name (`dev`)     |
| Runtime error, trace or latency | Scope's `list_operations`, then `search_traces`, then `read_trace` or `measure_latency` |
