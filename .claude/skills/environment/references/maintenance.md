# Maintenance

This reference holds the machines' setup, upkeep and rebuild. Do established upkeep without asking for each step. Ask only for missing access, a new scope, or an interruption of running work. T3 updates itself, Claude Code and Codex. Report only failures and gaps.

## Machines

The workers are `dev` and `desktop`. Both run the latest Debian stable in text mode, with the same setup, as `mp281x` with passwordless sudo. The user can reset any machine at any time, so setup never copies sign-ins or configuration from another machine. The Mac is only a control plane: agents never set it up or clean it, and its SSH files follow [Access changes](#access-changes).

| Fact      | `dev`                                                              | `desktop`                                             |
| --------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| Hardware  | VPS with 8 cores, 23 GB and 15 GB swap                             | Ryzen 9 9900X, 30 GB, 31 GB swap, RTX 5070, 1 TB NVMe |
| Network   | Always on, public `77.237.236.132`; ufw allows 80 and 443          | Home LAN on Ethernet `eno1`; ufw denies all incoming  |
| Only here | Traefik for every `*.mp281x.xyz` public app, Datapizza VPN, Jaeger | NVIDIA driver and the Docker `nvidia` runtime         |
| GitLab    | Through the VPN; advertises the route to the tailnet               | Through dev's route (`--accept-routes`)               |

- **Sudo.** Codex and Claude run sudo without a terminal, so `/etc/sudoers.d/99-mp281x-nopasswd` holds `mp281x ALL=(ALL:ALL) NOPASSWD: ALL` with mode 0440.
- **Toolchain.** Docker with Compose and Buildx, `gh` with the `github/gh-stack` extension, `glab`, git, build tools, rsync, ripgrep, jq, sqlite3, ffmpeg and Python. Vite+ in `~/.vite-plus` holds Codex, agent-browser and `t3@nightly`; Claude Code lives in `~/.local/bin`.
- **Sign-ins.** Each worker signs in on its own: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login` and `codex login --device-auth`. Show each sign-in link to the user.
- **Repositories.** `~/deslop` uses `MP281X <paludgnachmatteo.dev@gmail.com>`. `~/dual` uses `Matteo Paludgnach <matteopaludgnach@datapizza.tech>` and the credential helper `!glab auth git-credential` for `https://git.datapizza.tech`. Run `gh auth setup-git` for GitHub.
- **Firewall.** Tailscale's `ts-input` chain accepts tailnet traffic and its UDP port before ufw, so ufw needs no rule for them. On dev, `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` lines off the VNC console.

## Access changes

- **Keys.** Every machine, the Mac included, holds the user's one ED25519 key pair as `~/.ssh/id_ed25519`, and `authorized_keys` holds only its public key. The user keeps a backup and gives the pair to a new or reset machine. No machine has a `~/.ssh/config` or other keys.
- **Before locking.** Turn off a login method only after a login by the remaining method succeeded from another machine. A claim that a key works is not proof.
- **Names.** The T3 environment name comes from `PRETTY_HOSTNAME`. Set it to the Tailscale name with `sudo hostnamectl set-hostname --pretty <name>`, and restart T3 to show it.

## Agent configuration

Every worker runs the same agent configuration, installed from the deslop repository over SSH. Install after every change to these sources, from the checkout that holds the change, on every worker in one pass.

- **Sources.** `.claude/settings.json`, `.claude/agents/pair.md`, `.claude/skills/{workflow,environment}/` and `.codex/config.toml`. Codex's `instructions.md` and personal skills are links to the Claude copies.
- **Origin.** Install only from main or from a branch with an open pull request, and bring every installed change to main.
- **Before writing.** Run `diff -r` between the source and each worker's installed copy. A difference your branch did not make came from another branch: bring it into your branch first, never overwrite it.
- **Public skills.** Engineering, design and testing stay repository copies that the coding-standards CLI refreshes.

```bash
for worker in dev desktop; do
  t=mp281x@$worker
  rsync -a --delete .claude/skills/workflow/ $t:.claude/skills/workflow/
  rsync -a --delete .claude/skills/environment/ $t:.claude/skills/environment/
  rsync -a .claude/settings.json $t:.claude/settings.json
  rsync -a --mkpath .claude/agents/pair.md $t:.claude/agents/pair.md
  rsync -a --mkpath .codex/config.toml $t:.codex/config.toml
  ssh $t 'mkdir -p ~/.codex/skills && ln -sfn ~/.claude/agents/pair.md ~/.codex/instructions.md && for s in workflow environment; do ln -sfn ~/.claude/skills/$s ~/.codex/skills/$s; done'
done
```

New sessions load the change; running threads keep the version they started with. Verify with the same `diff -r`, and check that each worker's sign-ins still work.

## Update and deploy

1. **Update.** Run `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade` and `vp update -g`. glab has no apt repository: when `https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, install its `glab_<version>_linux_amd64.deb`. Restart the Docker engine only with the workload preservation below. After harness updates, recheck native configuration capabilities and install the [agent configuration](#agent-configuration).
2. **T3.** Both machines run T3's nightly channel as the `t3code.service` user unit, and T3 updates itself. A machine without `t3` runs `vp install -g t3@nightly` and `t3 service install`. Then `t3 connect link --headless` prints a device sign-in link for the user, and `t3 connect publish` turns on push notifications. Run `t3 service restart` afterwards, because T3 reads the link at startup.
3. **Deploy.** On dev, from `~/deslop` on published main, run `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`. A changed inline config needs `up -d --force-recreate --no-deps <service that mounts it>`.
4. **Verify.** https://portfolio.mp281x.xyz and dev's http://127.0.0.1:16686/api/services must return 200. An OPTIONS preflight to otel's `/v1/traces` and `/v1/logs` with `Origin: https://portfolio.mp281x.xyz` must succeed.
5. **Tailscale.** It carries SSH and previews. Run the block below on a new machine. When `tailscale up` prints a sign-in URL, show it to the user. Then the user disables key expiry at https://login.tailscale.com/admin/machines. MagicDNS and HTTPS certificates are on for the tailnet. With the Datapizza VPN, the machine also advertises the VPN's route to GitLab, and the user approves it on the machines page.

   ```bash
   command -v tailscale >/dev/null || {
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.noarmor.gpg | sudo tee /usr/share/keyrings/tailscale-archive-keyring.gpg >/dev/null
     curl -fsSL https://pkgs.tailscale.com/stable/debian/trixie.tailscale-keyring.list | sudo tee /etc/apt/sources.list.d/tailscale.list
     sudo apt-get update && sudo apt-get install -y tailscale
   }
   openvpn3 configs-list 2>/dev/null | grep -q datapizza && R=$(getent ahostsv4 git.datapizza.tech | awk 'NR == 1 {print $1}')/32
   sudo tailscale up --accept-routes --advertise-routes=$R
   ```

## Clean

Remove rebuildable data, never unsettled work. A worktree is disposable only when every thread that owns it is settled, no run is queued and no process uses it. Waiting for the user is not settled. Two threads can share one worktree and its preview stage.

Check owners through T3's thread tools or the environment's T3 state. `orchestration_v2_projection_threads.payload_json` holds `worktreePath`, `settledAt` and `settledOverride`. Join each owner's latest `orchestration_v2_projection_runs` row for activity. A missing path, listener or row starts an investigation; it never permits deletion. Unknown owners, stopped containers, unattached volumes and the shared production `deslop` project stay.

1. **Removed worktrees.** Find Compose projects whose `com.docker.compose.project.working_dir` is gone, processes with a deleted working directory, Serve mappings with no backend and `~/.deslop` folders without a checkout. After every owner is confirmed settled, remove only that project (`down --volumes --remove-orphans`), process group, mapping (`sudo tailscale serve --https=<port> off`) or folder. Keep `~/.deslop/{deploy,measure,repos}`. The tailnet listener itself is not a Serve backend.
2. **Settled worktrees.** Destroy the worktree's Alchemy preview or Compose project when its data is disposable. Move `node_modules/.cache/deslop/proof/` to `~/.deslop/proof/<worktree directory name>/`. Run `git worktree remove --force --force <path>` only for a clean worktree; the branch keeps every commit. List dirty worktrees for the user instead. Delete `~/.deslop/<worktree directory name>/`.
3. **`/tmp`.** Remove user-owned data only for settled owners with no open handles (`lsof +D`). Keep `claude-*` and `codex*` session folders.
4. **Caches.** With no build running, run `docker image prune -a -f` and `docker builder prune -a -f`. With no install running, run `vp pm cache clean` in `~/deslop` and `~/dual` and clear identified caches under `~/.npm` and `~/.cache`. Remove noncurrent Vite+, Node and package-manager versions, and unused Codex releases. Run `journalctl --vacuum-size=100M`. Never run a blanket Docker system or volume prune or a negated-label exclusion.
   \1 Skip this step while `~/.t3/runtime/service-state.json` shows an update that is not `committed`. After T3 updates itself, the unit's launcher stays on the old version, and `t3 service status` reports a repair. With no run active, run `t3 service install`, which restarts T3. With runs active, point `ExecStart` in `~/.config/systemd/user/t3code.service` at the active version in `~/.t3/runtime/service-state.json` and run `systemctl --user daemon-reload`. Delete other versions only after the repair; otherwise the next start finds no launcher.
5. **Report.** Show `df -h /` before and after, what each step removed and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`). Count every worktree's `node_modules` in one `du`, because installs hardlink from the stores.

## Docker binding defaults

`/etc/docker/daemon.json` binds new bridge and legacy-bridge publishes to loopback. Live restore keeps containers running through later compatible daemon restarts. A worker with a GPU adds the `nvidia` runtime with `nvidia-ctk runtime configure --runtime=docker`.

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

## Desktop GPU

NVIDIA's Debian 13 repository supplies `nvidia-open`, which builds the open kernel modules through DKMS. Secure Boot is on. The kernel loads the modules only after the user enrolls the DKMS signing key, which needs a monitor and a keyboard once:

1. Run `sudo mokutil --list-new`. When it lists no key, run `sudo mokutil --import /var/lib/dkms/mok.pub` and choose a one-time password.
2. Reboot. In the blue MOK manager, choose **Enroll MOK**, **Continue** and **Yes**, type the password, and reboot.
3. Check that `nvidia-smi` lists the RTX 5070, and that `docker run --rm --gpus all debian nvidia-smi` does too.

A reboot without a keyboard skips the MOK manager and drops the pending key. Until enrollment, `nvidia-persistenced` and `nvidia-cdi-refresh` fail, and `systemctl is-system-running` reports `degraded`.

## Set up a worker

These steps set up a worker from a Debian netinst image. Select only the SSH server task in the installer, because the desktop tasks install GNOME.

1. Install `sudo`, `network-manager` and `ufw`, and mark them as manual. Purge any desktop stack with `--autoremove`: the `task-*desktop` tasks, GNOME, GDM, LibreOffice, Firefox, Evolution, CUPS, Avahi, BlueZ, ModemManager and PipeWire. Keep `multi-user.target` as the default target.
2. Write the sudoers file. Add the Docker and GitHub CLI apt sources, each key in `/etc/apt/keyrings/<name>.gpg`, and install the toolchain and `glab`. Add `mp281x` to the `docker` group and write the Docker binding defaults.
3. Install the user's key pair per [Access changes](#access-changes). Run the Tailscale block and show its sign-in link to the user. After a second SSH login over the tailnet works, set `ufw default deny incoming`, allow 80 and 443 only on dev, and enable ufw.
4. On dev only: add the OpenVPN 3 apt source and install `openvpn3-client`. Import the VPN with `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect it, and advertise its route.
5. Run `loginctl enable-linger mp281x`. As `mp281x`, install Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages and Claude Code. Run `agent-browser install --with-deps`, then the T3 step, and set `PRETTY_HOSTNAME`.
6. Run the sign-ins and `gh extension install github/gh-stack`. Clone both repositories with their identities, and add each with `t3 project add --title <name> <path>`. On dev, deploy the public apps.
7. Install the [agent configuration](#agent-configuration).
8. After a key login from another machine succeeds, write `/etc/ssh/sshd_config.d/10-keys-only.conf` with `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no` and `X11Forwarding no`. Run `sudo sshd -t && sudo systemctl reload ssh`.
9. With an NVIDIA GPU, enable `contrib` and `non-free`, and add NVIDIA's CUDA and container toolkit sources. Install `linux-headers-amd64`, `nvidia-open` and `nvidia-container-toolkit`. Add the `nvidia` runtime, and enroll the key per [Desktop GPU](#desktop-gpu).
