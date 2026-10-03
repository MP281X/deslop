---
name: maintenance
description: 'Updating, redeploying, and cleaning this machine. Use when the user asks to update or clean the machine, or to redeploy deslop.'
---

# Maintenance

## Recurring work

**Authority.** Perform established upkeep autonomously. Ask only for missing access, new cadence/scope or a consequential interruption—not approval for each routine step. T3 manages its own, Claude Code's and Codex's updates.

**Schedule.** Use T3's persistent scheduler in a stable maintenance thread, not native Cron or a shell daemon. Reuse the agreed cadence/scope; do not overlap upkeep. Dispatch success is not task success. Keep canonical instructions current; report only actionable failures/gaps.

### Scheduler

- **Create.** Structured schedule; inherited model/modes, local server timezone. Keep scheduledTaskId; report cadence/nextRunAt.
- **Bind.** Stable root-checkout thread. Unbound jobs create sidebar conversations; avoid them. Inspect the actual task result and prevent overlapping turns.
- **Watch.** Pipeline/child waits are not recurring jobs. Pause failures; never interpret successful dispatch as safe cleanup.

## Upkeep

**Preserve.** Steps 1–5 update/deploy; 6–10 clean. Remove rebuildable caches, not unsettled data. Protect active/queued/waiting owners, stopped containers and unattached volumes. Missing listeners/cwd are not disposal evidence; unknown ownership stays.

1. **Update.** `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade`, `vp update -g`. Coordinate Docker engine restarts with workload preservation; don't replace T3-managed harnesses. Recheck changed native config capabilities; install personal sources through environment's Deslop procedure.
2. **Deploy.** From `~/deslop` on published main: `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`. Inline configs need `up -d --force-recreate --no-deps <mounting-service>`.
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
9. **Caches.** No active build: `docker image prune -a -f`, `docker builder prune -a -f`. No install: `vp pm cache clean` in `~/deslop` and `~/dual`; identified package/build caches under `~/.npm`/`~/.cache`. Remove only unused T3/Codex releases, noncurrent Vite+ versions, older Node versions within each major and older package-manager versions. `journalctl --vacuum-size=100M`. Preserve hardlinked worktree packages. No blanket Docker system/volume prune or negated-label exclusions; persistent cleanup remains owner-scoped in 6–7.
10. Report `df -h /` before and after, what each step removed, and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`), counting `node_modules` of all worktrees in one `du`, since installs hardlink from the stores.

## Docker binding defaults

**Configure.** `/etc/docker/daemon.json` sets new bridge and legacy-bridge publishes to loopback; live restore protects containers during later compatible daemon restarts:

```json
{
	"live-restore": true,
	"ip": "127.0.0.1",
	"default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}
}
```

**Activate.** Validate against actual dockerd startup flags. Binding defaults require restart, not reload; legacy bridge reconfiguration needs no active sandboxes. Preserve IDs/volumes, gracefully stop workloads when authorized, restart the same daemon, then restore exactly those containers and verify health.

**Verify.** Fresh volume-free probe on a new bridge and legacy bridge, with `-p <container-port>` and no explicit host IP: inspect resolved publish, require loopback success and nonloopback failure. Remove only returned probe IDs. Existing user-defined networks keep old options; migrate at owner-scoped recreation, not blanket cleanup. Explicit publishes override defaults; production 80/443 intentionally bind both families.
