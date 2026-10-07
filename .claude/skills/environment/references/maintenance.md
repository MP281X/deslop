# Maintenance

Do established upkeep without asking for each step. Ask only for missing access, a new scope, or an interruption of running work. T3 updates itself, Claude Code and Codex. Report only failures and gaps.

## Update and deploy

1. **Update.** Run `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade` and `vp update -g`. Restart the Docker engine only with the workload preservation below. After harness updates, recheck native configuration capabilities and install personal sources through the [Deslop](deslop.md#install-personal-configuration) procedure.
2. **Deploy.** From `~/deslop` on published main, run `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`. A changed inline config needs `up -d --force-recreate --no-deps <service that mounts it>`.
3. **Verify.** https://portfolio.mp281x.xyz and http://127.0.0.1:16686/api/services must return 200. An OPTIONS preflight to otel's `/v1/traces` and `/v1/logs` with `Origin: https://portfolio.mp281x.xyz` must succeed.
4. **Tailscale.** It carries SSH and previews. Run the block below. When `tailscale up` prints a sign-in URL, show it to the user. Then the user disables key expiry at https://login.tailscale.com/admin/machines and turns on MagicDNS and HTTPS Certificates at https://login.tailscale.com/admin/dns. With the Datapizza VPN, the machine also advertises the VPN's route to GitLab, and the user approves it on the machines page.

   ```bash
   command -v tailscale >/dev/null || {
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
     sudo apt-get update && sudo apt-get install -y tailscale
   }
   openvpn3 configs-list | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
   sudo tailscale up --advertise-routes=$R
   ```

5. **Firewall.** ufw allows only 80/tcp and 443/tcp for traefik. Everything else arrives through Tailscale, whose rules accept the tailnet interface before ufw. `/etc/sysctl.d/90-quiet-console.conf` holds `kernel.printk = 3 4 1 3`, so the VNC console shows kernel errors without every `[UFW BLOCK]` line.

## Clean

Remove rebuildable data, never unsettled work. A worktree is disposable only when every thread that owns it is settled, no run is queued and no process uses it. Waiting for the user is not settled. Two threads can share one worktree and its preview stage.

Check owners through T3's thread tools or the environment's T3 state. `orchestration_v2_projection_threads.payload_json` holds `worktreePath`, `settledAt` and `settledOverride`. Join each owner's latest `orchestration_v2_projection_runs` row for activity. A missing path, listener or row starts an investigation; it never permits deletion. Unknown owners, stopped containers, unattached volumes and the shared production `deslop` project stay.

6. **Removed worktrees.** Find Compose projects whose `com.docker.compose.project.working_dir` is gone, processes with a deleted working directory, Serve mappings with no backend and `~/.deslop` folders without a checkout. After every owner is confirmed settled, remove only that project (`down --volumes --remove-orphans`), process group, mapping (`sudo tailscale serve --https=<port> off`) or folder. Keep `~/.deslop/{deploy,measure,repos}`. The tailnet listener itself is not a Serve backend.
7. **Settled worktrees.** Delete `node_modules/.cache/deslop/*` except `proof/`. Delete `~/.deslop/<worktree directory name>/`. When its data is disposable, remove the worktree's Compose project with `down --volumes`, or destroy its Alchemy preview before removing the checkout. Compare the preserved resource IDs afterwards, because exit code 0 does not prove preservation.
8. **`/tmp`.** Remove user-owned data only for settled owners with no open handles (`lsof +D`). Keep `claude-*` and `codex*` session folders.
9. **Caches.** With no build running, run `docker image prune -a -f` and `docker builder prune -a -f`. With no install running, run `vp pm cache clean` in `~/deslop` and `~/dual` and clear identified caches under `~/.npm` and `~/.cache`. Remove unused T3 and Codex releases, noncurrent Vite+ versions, older Node versions within each major and older package-manager versions. Run `journalctl --vacuum-size=100M`. Keep packages hardlinked into worktrees. Never run a blanket Docker system or volume prune or a negated-label exclusion.
10. **Report.** Show `df -h /` before and after, what each step removed and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`). Count every worktree's `node_modules` in one `du`, because installs hardlink from the stores.

## Docker binding defaults

`/etc/docker/daemon.json` binds new bridge and legacy-bridge publishes to loopback. Live restore keeps containers running through later compatible daemon restarts:

```json
{
	"live-restore": true,
	"ip": "127.0.0.1",
	"default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}
}
```

- **Activate.** Binding defaults need a daemon restart, not a reload, and the legacy bridge changes only without active sandboxes. Check the real dockerd flags first. When authorized, stop workloads gracefully and restart the daemon. Then restore exactly those containers with their IDs and volumes, and check their health.
- **Verify.** Run a volume-free probe on a new bridge and on the legacy bridge with `-p <container-port>` and no host IP. Inspect the resolved publish: loopback must connect and other interfaces must not. Remove only the probe containers.
- **Limits.** Existing user-defined networks keep their old options until their owner recreates them. Explicit publishes override the defaults. Production 80 and 443 bind both address families on purpose.
