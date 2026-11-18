---
name: environment
description: Load before a command on another worker, starting a preview, opening a device, reading a trace or runtime error, deploying, publishing, a sign-in, reading Stash data, reading an outside repository or a package's source, opening or stacking a PR, a maintenance pass, or any Dual task.
---

# Environment

Two headless Debian workers, a MacBook and an iPhone in one tailnet.

| Name          | Address          | Role                                                                       |
| ------------- | ---------------- | -------------------------------------------------------------------------- |
| `desktop`     | `100.97.120.3`   | Fastest; sometimes off                                                     |
| `dev`         | `100.68.201.107` | Always on: Deslop apps for `*.mp281x.xyz`                                  |
| `macbook-pro` | `100.115.207.60` | The user's control plane, the iOS Simulator and a Deploy worker, on demand |
| `iphone`      | `100.117.217.10` | T3 client only                                                             |

- **Names.** MagicDNS short names; `<name>.tailnet-8c4c.ts.net` has HTTPS certificates. SSH as `mp281x@dev`, `mp281x@desktop`, `matteopaludgnach@macbook-pro`.
- **Tools.** `vp` and `vpx` on `PATH`, also over SSH; `gh`, `glab` and the MCP gateway signed in.
- **Git refs.** T3 checkpoints under `refs/t3/`; search history with `--branches --remotes`.
- **Auxiliary services.** Run task-local ones as temporary containers, not installs on the worker.
- **Agent MCP.** [Keyring and MCP](references/maintenance.md#keyring-and-mcp).

| Reference                                | For                                                      |
| ---------------------------------------- | -------------------------------------------------------- |
| [Deslop](references/deslop.md)           | Production, Stash data, npm, Apple and EAS, tracing      |
| [Dual](references/dual.md)               | Accounts, merges, preview, Jira, Google, VPN, tracing    |
| [Maintenance](references/maintenance.md) | Workers, setup, agent links, T3 settings, updates, clean |
| [Repositories](references/repos.md)      | The packages we use and reference repositories           |

## Previews

One per worktree: the systemd user unit `preview-<worktree name>`, shared over tailnet HTTPS.

- **Script.** When a capture needs it, run the project's preview script (read it with `t3_project_read`) from the worktree root, and give its HTTPS URL once it answers. Maintenance removes a gone worktree's unit. Deslop's selects a changed web app, else Portfolio; `PREVIEW_APP=<app>` previews another app of the same change. The repository's own preview command or a background task bypasses the unit and dies with the turn.
- **Webhooks.** Funnel exposes a whole port: pick a free one of 443, 8443, 10000 and run `sudo tailscale funnel --bg --https=<port> --set-path <path> http://127.0.0.1:<api port><path>`; remove it with `... --set-path <path> off`.

## Tools

| Question                        | Tool                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime state                   | Deploy's `list_apps` or `read_resource_history`, with the full worker name (`dev.mp281x.xyz`); host checks follow the maintenance reference |
| Runtime error, trace or latency | Scope's `list_operations`, then `search_traces`, then `read_trace` or `measure_latency`                                                     |

## Pull requests

- **Drafts.** The first push opens a draft; a ready PR whose layer changes goes back to draft. Before ending a turn, unlink PRs the host reports merged or closed.
- **Stacks.** One branch per layer, each readable alone, restacked only with the commands below; corrections fold into their own layer before restacking onto the latest default branch.

GitHub stacks act on the checked-out branch's stack; GitHub rebases the next layer when the one below merges.

```bash
gh stack init <bottom> [<next> …]    # start, or adopt existing branches bottom first
gh stack add <branch>                # a new layer on top, checked out before its first commit
gh stack rebase [--upstack]          # before a push, or above an amended layer; --continue or --abort on a conflict
gh stack submit --auto               # first push: opens each PR as a draft on its parent
gh stack push                        # later rounds
gh stack sync --prune                # after a merge below
```

GitLab stacks act on the stack selected in this worktree: one commit per diff on its own branch, its first message line the MR title (`Draft: ` opens a draft). Every MR comes from `sync`, which never edits an existing MR. `infer` needs a TTY and an editor; `glab stack create` cannot run in a worktree.

```bash
script -qec "GLAB_EDITOR='sh -c \"git rev-list --reverse origin/<default>..HEAD > \\\$1\" -' glab stack infer --name <stack> origin/<default>..HEAD" /dev/null
git add -A && glab stack save -m 'Draft: <title>'    # a new layer; `amend` folds into the checked-out one
glab stack sync --skip-push --update-base            # before the push, and after a merge below
glab stack sync                                      # push the stack, open missing MRs
glab api "projects/:id/pipelines/<pipeline>/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'; glab ci trace <job id>
```
