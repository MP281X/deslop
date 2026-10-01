---
name: maintenance
description: 'Updating, redeploying, and cleaning this machine. Use when the user asks to update or clean the machine, or to redeploy deslop.'
---

# Maintenance

Steps 1–5 run when the user asks to update the machine or redeploy; steps 6–10 run in full when the user asks to clean it. Clean aggressively: anything not needed right now goes, since downloads are fast and whatever a thread still needs it rebuilds.

1. Update: `apt-get update`, `apt-get upgrade -y`, `apt-get autoremove -y`, `apt-get clean`, `vp upgrade`, and `vp update -g`. Claude Code and t3 update themselves. After a Claude Code or Codex release, compare its default system prompt (Claude Code's body for Opus, Codex's `instructions_template` in `~/.codex/models_cache.json`) with the copies the workflow replaces it with, the `<harness>` section of `agents/claude/agents/pair.md` and `agents/codex/instructions.md` in deslop, and carry over what changed.
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

6. Remove what removed worktrees left: compose projects other than `deslop` whose `com.docker.compose.project.working_dir` no longer exists (`docker compose --project-name <project> down --volumes --remove-orphans`), listeners whose `/proc/<pid>/cwd` ends in `(deleted)` (stop their process group), `tailscale serve` ports nothing listens on anymore (`sudo tailscale serve --https=<port> off`), and every folder in `~/.deslop` other than `deploy`, `measure`, and `repos` whose name matches no checkout in `git worktree list` of `/home/mp281x/deslop` or `/home/mp281x/dual` and that no running process uses as its working directory (`/proc/*/cwd`).
7. Remove what idle worktrees keep: for each worktree whose t3 threads (`projection_threads` in `~/.t3/userdata/state.sqlite`, by `worktree_path`) are all settled or wait on nothing but the user, and that no running process uses as its working directory, delete `node_modules/.cache/deslop/*` except `proof/` and `done-when.md`, and `~/.deslop/<worktree directory name>/`, and take its compose project down with `--volumes`.
8. Clear `/tmp`, which is on the root disk and is never emptied until a reboot: every entry of the user that no process holds open (`lsof +D`), keeping `claude-*` and `codex*` session folders.
9. Clear every cache and every version not in use: `docker system prune -a -f` and `docker volume prune -a -f` (running stacks keep theirs); with no install running, `vp pm cache clean` in `/home/mp281x/deslop` (the pnpm store) and `/home/mp281x/dual` (the bun cache), `~/.npm`, and `~/.cache/*`; every version under `~/.t3/runtime/versions` and `~/.codex/packages/app-server-daemon/releases` that no running process uses, every `~/.vite-plus/<version>` except the `current` target, every `~/.vite-plus/js_runtime/node` version except the newest of each major line, and all but the newest of each `~/.vite-plus/package_manager/*`; and `journalctl --vacuum-size=100M`. Worktrees keep their hardlinked packages.
10. Report `df -h /` before and after, what each step removed, and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`), counting `node_modules` of all worktrees in one `du`, since installs hardlink from the stores.
