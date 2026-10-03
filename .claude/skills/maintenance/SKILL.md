---
name: maintenance
description: 'Updating, redeploying, and cleaning this machine. Use when the user asks to update or clean the machine, or to redeploy deslop.'
---

# Maintenance

## Recurring work

Use T3's persistent scheduler for a recurring maintenance request, not native Cron tools or a shell daemon. Agree the cadence and whether the job only inspects or also mutates; no schedule is installed just because maintenance was suggested. Create it from a stable root-checkout maintenance thread with the intended provider/model, not a feature thread.

The smallest first job inspects disk usage, failed services, orphaned worktree resources and available updates, then reports only actionable changes with evidence. It does not upgrade, deploy, prune, delete, stop services or change configuration. A recurring mutating job needs the user's actual upkeep scope; apply the existing steps below, preserve active worktrees/services and collect each command's result. Do not overlap an earlier upkeep run or equate successful schedule dispatch with successful maintenance. Record machine changes in the canonical skills and repository as usual, not by editing installed copies.

### Scheduler

- `schedule_task` inherits the creating thread's provider/model/modes, with no target override. Fixed times use the server process's local timezone and a structured object, e.g. {type: 'fixed_time', timeOfDay: '09:00', weekdays: [1,2,3,4,5]}; intervals have a one-minute minimum. Only the server must stay up.
- Bound schedules retain the thread's workspace and can steer an active turn; maintenance needs a stable thread, not a disposable feature worktree. Unbound schedules create a fresh top-level worktree conversation per run, not a child. Cadence is user-owned.
- Scheduler success means dispatch, not task success: inspect the thread result. No one-shot schedule or guaranteed provider-turn non-overlap. Overdue intervals catch up once; fixed times over ten minutes late are skipped.
- Retain scheduledTaskId for inspection/edit/pause/delete; report returned cadence and nextRunAt. Ordinary pipeline watches and child completion are not recurring schedules.

## Upkeep

Steps 1–5 run when the user asks to update the machine or redeploy; steps 6–10 run in full when the user asks to clean it. Remove rebuildable caches aggressively. Preserve active, queued and unsettled worktree resources, including stopped containers and unattached volumes; absence of a listener or process cwd does not establish that their data is disposable. Resolve ownership before deletion; unknown ownership stays untouched.

1. Update: `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade`, and `vp update -g`. Claude Code and t3 update themselves. After a Claude Code or Codex release, check the native configuration keys and capabilities our minimal `.claude/agents/pair.md` and `.codex/instructions.md` bases rely on; update only relevant bootstrap/environment facts, never import the default prompt's unused model catalogue, slash commands or native orchestration using the `workflow-maintenance` skill's Install recipe.
2. Deploy from `/home/mp281x/deslop` on an up-to-date `main` once its CI run has published the portfolio image: `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`; compose ignores changes to inline `configs`, so after one changes, also `up -d --force-recreate --no-deps` the service that mounts it.
3. Verify that https://portfolio.mp281x.xyz and the local Jaeger API http://127.0.0.1:16686/api/services return 200, and that an OPTIONS preflight to `/v1/traces` and `/v1/logs` on otel with `Origin: https://portfolio.mp281x.xyz` succeeds.
4. Tailscale carries SSH and previews. Run these; when `tailscale up` prints a sign-in URL, show it, then have the user disable key expiry for the machine at https://login.tailscale.com/admin/machines and turn on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns. On a machine with the Datapizza VPN, it also shares the VPN's route to GitLab with the user's devices, which the user approves on the same machines page:

   ```bash
   command -v tailscale >/dev/null || {
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
     sudo apt-get update && sudo apt-get install -y tailscale
   }
   openvpn3 configs-list | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
   sudo tailscale up --advertise-routes=$R
   ```

5. ufw allows only 80/tcp and 443/tcp, for traefik. SSH and everything else arrive through Tailscale, whose own rules accept the tailnet interface ahead of ufw. The VNC console shows only kernel errors: `/etc/sysctl.d/90-quiet-console.conf` holds `kernel.printk = 3 4 1 3`, since the default level prints every `[UFW BLOCK]` line.

6. Inventory leftovers from removed worktrees: Compose projects whose `com.docker.compose.project.working_dir` disappeared, processes with deleted cwd, Serve mappings with absent backends and `~/.deslop` folders without a checkout. Missing paths/listeners are investigation signals, not deletion permission. Verify the owning threads are settled as in step 7; preserve unknown owners and shared production `deslop`. Then remove only the identified project (`down --volumes --remove-orphans`), process group, mapping (`sudo tailscale serve --https=<port> off`) or scratch folder. Keep `~/.deslop/{deploy,measure,repos}`. The tailnet listener is not a Serve backend.
7. Remove what settled worktrees keep: verify their t3 threads (`projection_threads` in `~/.t3/userdata/state.sqlite`, by `worktree_path`) are all settled, with no queued work or process using the worktree. Waiting for the user is not settled. Delete `node_modules/.cache/deslop/*` except `proof/` and `done-when.md`, and `~/.deslop/<worktree directory name>/`. Remove only that worktree's identified resources: its Compose project with `down --volumes`, or its Alchemy preview with `vp run preview:destroy` before removing the checkout/state. Never target shared production `deslop`. Compare preserved resource IDs after cleanup; a command's exit 0 alone is not preservation proof.
8. Remove user-owned `/tmp` data only after verifying settled ownership and no open handles (`lsof +D`). Closed files may still belong to queued work or a thread waiting for the user; preserve unsettled and unknown owners, and `claude-*`/`codex*` session folders.
9. Clear rebuildable caches and unused versions: with no build running, `docker image prune -a -f` and `docker builder prune -a -f`; with no install running, `vp pm cache clean` in `/home/mp281x/deslop` (the pnpm store) and `/home/mp281x/dual` (the bun cache), plus identified package/build caches under `~/.npm` and `~/.cache`, not unknown contents; every version under `~/.t3/runtime/versions` and `~/.codex/packages/app-server-daemon/releases` that no running process uses, every `~/.vite-plus/<version>` except the `current` target, every `~/.vite-plus/js_runtime/node` version except the newest of each major line, and all but the newest of each `~/.vite-plus/package_manager/*`; and `journalctl --vacuum-size=100M`. Worktrees keep their hardlinked packages. Do not use blanket Docker system/volume pruning or negated-label exclusions: unattached resources may belong to unfinished work. Persistent resources are removed only through the identified owner in steps 6–7.
10. Report `df -h /` before and after, what each step removed, and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`), counting `node_modules` of all worktrees in one `du`, since installs hardlink from the stores.
