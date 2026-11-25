---
name: environment
description: Load before a command on `worker` or the Mac, starting a preview, opening a device, reading a trace or runtime error, deploying, a sign-in, reading an outside repository or a package's source, opening or writing a pull request, a maintenance pass, or any Dual task.
---

# Environment

| Name          | Address                                   | Role                                                                                                        |
| ------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `worker`      | `100.109.254.43`, public `109.238.11.220` | The Debian machine (Ryzen 7 9700X, 64 GB): production at `*.mp281x.xyz`, agents, previews, fix, check, test |
| `macbook-pro` | `100.115.207.60`                          | The iOS Simulator, on demand; sometimes the control plane; no Deploy                                        |
| `iphone-duo`  | `100.69.97.49`                            | The main control plane: T3 on the inner screen, held upright and sometimes rotated                          |

- **Names.** Tailnet short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@worker`, `matteopaludgnach@macbook-pro`.
- **Tools.** On `worker`, `vp`, `vpx`, `gh`, `glab` and the MCP gateway are installed and signed in, also over SSH; the Mac has only T3, Xcode and Vite+.
- **Git refs.** T3 checkpoints live under `refs/t3/`; search history with `--branches --remotes`.
- **Checks.** Fix, check and test run on `worker`, unthrottled, before each push; CI only confirms.
- **Auxiliary services** a task needs run as temporary containers, not installs.
- **Outside source.** Clone what you need on demand into `/tmp/repos/<name>` (`git pull --ff-only` an existing clone, else `git clone --depth 1`) and read it there, never editing. Start from Effect for Effect APIs; T3 Code, opencode and executor show how agent apps are built.

| Reference                                    | For                                                                  |
| -------------------------------------------- | -------------------------------------------------------------------- |
| [Dual](references/dual.md)                   | Accounts, AWS, Jira, Google, VPN, preview, tracing                   |
| [Maintenance](references/maintenance.md)     | `worker`'s state and the Mac: setup, agent links, updates, reconcile |
| [Pull requests](references/pull-requests.md) | Drafts, stacks, GitHub and GitLab stack commands, bodies             |

## Previews

Start one only when a capture needs it, from the worktree root, through the project's `preview` script (`t3_project_read`): Deslop's `vp run preview [app]` and `vp run preview:stop`; Dual's [prod-like preview](references/dual.md#preview). Pass the URL it prints to whoever walks it: the reviewer, or him when he asked to try it. An app's own `preview` script or a background task dies with the turn.

Never open a Funnel or another public route for a preview: it puts the whole port on the internet. When a proof needs a real webhook delivery, tell the user it is blocked.

## Tools

| Question                        | Tool                                                                                    |
| ------------------------------- | --------------------------------------------------------------------------------------- |
| Runtime state                   | Deploy's `list_apps` or `read_resource_history`, about `worker`                         |
| Runtime error, trace or latency | Scope's `list_operations`, then `search_traces`, then `read_trace` or `measure_latency` |
