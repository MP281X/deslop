---
name: maintenance
description: 'Updating, redeploying and cleaning this machine. Use when the user asks to update or clean the machine, or to redeploy deslop.'
---

# Maintenance

Do established upkeep without asking for each step; ask only for missing access, a new cadence or scope, or an interruption of running work. T3 updates itself, Claude Code and Codex. Recurring upkeep runs through T3's scheduler in one stable maintenance thread bound to the root checkout, never native cron or a shell daemon, and never overlaps itself. A dispatched run is not a successful run: inspect its result and report only failures and gaps.

## Update and deploy

1. **Update.** `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade`, `vp update -g`. Restart the Docker engine only with the workload preservation below. Recheck native configuration capabilities after harness updates, and install personal sources through environment's Deslop procedure.
2. **Deploy.** From `~/deslop` on published main: `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`. A changed inline config needs `up -d --force-recreate --no-deps <service that mounts it>`.
3. **Verify.** https://portfolio.mp281x.xyz and http://127.0.0.1:16686/api/services return 200, and an OPTIONS preflight to otel's `/v1/traces` and `/v1/logs` with `Origin: https://portfolio.mp281x.xyz` succeeds.
4. **Tailscale.** It carries SSH and previews. Run the block below. When `tailscale up` prints a sign-in URL, show it, then have the user disable key expiry at https://login.tailscale.com/admin/machines and turn on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns. With the Datapizza VPN, the machine also advertises the VPN's route to GitLab, which the user approves on the machines page.

   ```bash
   command -v tailscale >/dev/null || {
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
     sudo apt-get update && sudo apt-get install -y tailscale
   }
   openvpn3 configs-list | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
   sudo tailscale up --advertise-routes=$R
   ```

5. **Firewall.** ufw allows only 80/tcp and 443/tcp for traefik; everything else arrives through Tailscale, whose rules accept the tailnet interface before ufw. `/etc/sysctl.d/90-quiet-console.conf` holds `kernel.printk = 3 4 1 3`, so the VNC console shows kernel errors but not every `[UFW BLOCK]` line.

## Clean

Remove rebuildable data, never unsettled work. A thread is settled only when T3 marks it settled, it has no queued run and no process uses its worktree; waiting for the user is not settled. Check ownership through T3's thread tools or environment's T3 state (`orchestration_v2_projection_threads.payload_json` holds `worktreePath`, `settledAt` and `settledOverride`; join the latest run for activity). A missing path, listener or row is a reason to investigate, never permission to delete. Unknown owners, stopped containers, unattached volumes and the shared production `deslop` project stay.

6. **Leftovers of removed worktrees.** Find Compose projects whose `com.docker.compose.project.working_dir` is gone, processes with a deleted working directory, Tailscale Serve mappings with no backend and `~/.deslop` folders without a checkout. After confirming the owner is settled, remove only that project (`down --volumes --remove-orphans`), process group, mapping (`sudo tailscale serve --https=<port> off`) or folder. Keep `~/.deslop/{deploy,measure,repos}`; the tailnet listener itself is not a Serve backend.
7. **Settled worktrees.** Delete `node_modules/.cache/deslop/*` except `proof/` and `~/.deslop/<worktree directory name>/`, then remove that worktree's own resources: its Compose project with `down --volumes`, or its Alchemy preview with `vp run preview:destroy` before removing the checkout. Compare the preserved resource IDs afterwards; exit code 0 does not prove preservation.
8. **`/tmp`.** Remove user-owned data only for settled owners with no open handles (`lsof +D`). Keep `claude-*` and `codex*` session folders.
9. **Caches.** With no build running: `docker image prune -a -f` and `docker builder prune -a -f`. With no install running: `vp pm cache clean` in `~/deslop` and `~/dual`, plus identified package caches under `~/.npm` and `~/.cache`. Remove unused T3 and Codex releases, old Vite+ versions, older Node versions within each major and older package-manager versions. `journalctl --vacuum-size=100M`. Keep packages hardlinked into worktrees. Never run a blanket Docker system or volume prune.
10. **Report** `df -h /` before and after, what each step removed, and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`), counting every worktree's `node_modules` in one `du` because installs hardlink from the stores.

## Docker binding defaults

`/etc/docker/daemon.json` binds new bridge and legacy-bridge publishes to loopback, and live restore keeps containers running through later compatible daemon restarts:

```json
{
	"live-restore": true,
	"ip": "127.0.0.1",
	"default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}
}
```

Binding defaults need a daemon restart, not a reload, and the legacy bridge changes only with no active sandboxes. Check the real dockerd flags first; when authorized, stop workloads gracefully, restart the daemon, restore exactly those containers with their IDs and volumes, and check their health. Verify with a volume-free probe on a new bridge and the legacy bridge using `-p <container-port>` without a host IP: loopback must connect and other interfaces must not. Remove only the probe containers. Existing user-defined networks keep their old options until their owner recreates them; explicit publishes override the defaults, and production 80 and 443 bind both address families on purpose.
