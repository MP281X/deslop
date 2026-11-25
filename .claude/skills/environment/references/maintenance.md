# Maintenance

A pass runs Update, then Clean, then Check on each powered-on worker, the workers in parallel, then reports faults, unknown owners, denied steps and an update waiting on the user's restart. Removals go to a Sonnet delegate, since Codex rejects `rm -rf`. A refusal or failure skips only its step.

- **The user's.** `t3 update`, `t3 doctor --fix`, `t3 service restart` and reboots; never report a pending T3 update.
- **Never touch** history (T3's databases and logs, `~/.claude/projects`, `~/.codex/sessions`), credentials, production data, running jobs or worktrees of running threads.

## Update

- **Debian.** `sudo apt-get update`, `upgrade -y`, `autoremove -y`, `clean`; `vp upgrade`; `gh extension upgrade --all`; the [AWS CLI](#aws-cli). glab: when `https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, `sudo dpkg -i` `https://gitlab.com/gitlab-org/cli/-/releases/<tag>/downloads/glab_<version>_linux_amd64.deb`.
- **Mac.** `vp upgrade`; report a pending macOS update from `softwareupdate -l`.
- **T3 CLI.** When `t3 --version` differs from `activeVersion` in `~/.t3/runtime/service-state.json`, `vp install -g t3@<activeVersion>`, never newer: T3 updates only from its UI.
- **Configuration.** `git -C ~/deslop pull --ff-only`. When local changes block it, read `git -C ~/deslop diff -w`: `git -C ~/deslop restore .` only a harness re-indent, then pull again; a real change goes into a PR.

## Clean

A thread owns a worktree through `worktreePath` in `orchestration_v2_projection_threads.payload_json`, its delegated children through `lineage.rootThreadId`; `settledAt`, `archived_at` or `deleted_at` settles it. Remove a worktree only when its thread is settled and, re-read right before removal, still settled with no process using it: the project's settle script, `git worktree remove --force --force`, `git worktree prune`.

- **Tool caches**, when unused: `rm -rf ~/.cache/{ms-playwright,node-gyp,puppeteer,google-chrome-for-testing-headless} ~/.npm/_npx`.
- **Claude versions.** `~/.local/share/claude/versions/<version>` except the one `claude --version` reports.
- **T3 versions.** Skip while `service-state.json` shows an uncommitted update. Keep `activeVersion`, the launcher named in `~/.config/systemd/user/t3code.service`'s `ExecStart`, and newer versions under `~/.t3/runtime/versions`.
- **Docker**, when no Docker or Compose build runs: `docker image prune -a -f`, `docker builder prune -a -f`; never `docker system prune`.
- **pnpm**, when no install runs: `pnpm store prune`.
- **Previews** of gone worktrees: Alchemy's `preview:destroy`; stopped `preview-*` units and their containers; `docker stop` (which keeps seed data, unlike Dual's `settle`) their surviving `dualos-local-*-wt-<hash>` Postgres and OpenSandbox containers. Also leftover `testcontainers-ryuk-*` and finished test runs' unnamed Postgres containers.
- **Local branches** in `~/deslop` and `~/dual`: `git branch -D` only branches no worktree checks out, never the default branch.
- **Remote branches**, only through this block: it deletes a branch whose merged or closed PR's head is the branch tip, whose nonempty commit list is all the user's, and which no worktree checks out; a failed query keeps it.

```bash
git fetch -q --prune origin
for b in $(git for-each-ref --format='%(refname:lstrip=3)' refs/remotes/origin | grep -vx 'HEAD\|main\|master'); do
  if git remote get-url origin | grep -q github.com; then
    pr=$(gh pr list --head "$b" --state all --json state,commits,headRefOid -q '.[0]') || continue
    s=$(jq -r '.state // empty' <<<"$pr"); h=$(jq -r '.headRefOid // empty' <<<"$pr"); a=$(jq -r '[.commits[].authors[].email] | unique | join(" ")' <<<"$pr")
  else
    mr=$(glab mr list --source-branch "$b" --all -F json | jq '.[0]') || continue
    s=$(jq -r '.state // empty' <<<"$mr"); h=$(jq -r '.sha // empty' <<<"$mr"); a=$(glab api "projects/:id/merge_requests/$(jq -r .iid <<<"$mr")/commits" | jq -r '[.[].author_email] | unique | join(" ")')
  fi
  case "$s" in MERGED|CLOSED|merged|closed) ;; *) continue ;; esac
  [ "$h" = "$(git rev-parse "origin/$b")" ] && [ -n "$a" ] && [ "$a" = "$(git config user.email)" ] || continue
  git worktree list --porcelain | grep -qxF "branch refs/heads/$b" || git push -q origin --delete "$b"
done
```

- **Mac caches**, keeping the active Claude, Node and Vite+ versions:

```bash
find ~/Library/Caches -maxdepth 1 -type d \( -iname '*updater*' -o -name '*.ShipIt' -o -name 'com.apple.Safari*' -o -name 'com.t3tools.t3code*' \) -exec rm -r -- {} +
rm -rf ~/Library/Caches/Google/Chrome ~/.cache/codex-runtimes "$HOME/Library/Application Support"/t3code*/{Cache,"Code Cache"}
```

## Check

- **Disk.** `df -h` and `df -i` per mount; `du -xhd1` under the home, `/var/lib` and `/tmp`; `sudo lsof -l +L1 -nP` for deleted-but-open files.
- **Ports.** `ss -ltnp`: name each listener's unit or container. A container published on `0.0.0.0`, except Minecraft's 25565, is a fault.
- **Units.** `systemctl --failed` and `systemctl --user --failed` are empty.
- **Agents.** `find ~/.claude/settings.json ~/.claude/agents/pair.md ~/.claude/skills ~/.codex/config.toml ~/.codex/instructions.md ~/.codex/rules/deny.rules ~/.codex/skills/{*,.system} -maxdepth 0 ! -type l` prints only `~/.codex/skills/.system`; `find -L ~/.claude/skills ~/.codex/skills -maxdepth 1 -type l` prints nothing; `~/deslop` is clean on current `main`.
- **T3.** `t3 --version` equals `activeVersion`; `t3 doctor --base-dir ~/.t3 --dry-run` prints "Nothing to repair"; `t3 connect status` ends "✓ Other devices can reach this machine".
- **sshd.** `sudo sshd -T` shows `usepam yes`, `passwordauthentication no`, `permitrootlogin no`.
- **VPN.** `git -C ~/dual ls-remote -q origin HEAD` succeeds; otherwise Dual's [VPN](dual.md#vpn).

## Setup and repair

### Debian worker

From a Debian netinst, in order:

1. **Base.** Passwordless sudo in `/etc/sudoers.d/99-mp281x-nopasswd` (0440); `sudo`, `network-manager`, `ufw`; `printf 'D /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf && sudo systemctl mask tmp.mount`.
2. **Packages.** Docker, `gh`, `glab`, `unattended-upgrades`, ripgrep, jq, sqlite3, btop, unzip, the [AWS CLI](#aws-cli); `mp281x` in `docker`; `/etc/docker/daemon.json`: `{"live-restore": true, "ip": "127.0.0.1", "default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}}`.
3. **Git.** `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled` true; `diff.algorithm histogram`, `merge.conflictStyle zdiff3`, `init.defaultBranch main`. Identity by remote, through `includeIf.hasconfig:remote.*.url:` on the https, `git@` and `ssh://` URLs of each host: `MP281X <dev@mp281x.xyz>` for `github.com`, `Matteo Paludgnach <matteopaludgnach@datapizza.tech>` for `git.datapizza.tech`.
4. **Network.** dev only: `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`. Tailscale from its Debian `trixie` apt repository; `sudo tailscale up --accept-routes`, on dev with `--advertise-routes=<git.datapizza.tech's IPv4>/32`; `sudo tailscale set --operator=mp281x`. Then, over the tailnet, `ufw default deny incoming`, dev allowing TCP 80, 443, 25565 and UDP 443.
5. **Shell.** `loginctl enable-linger mp281x`; Vite+ with `VP_HOME="$HOME/.vite-plus"`, Claude Code; `~/.bashrc`'s first lines put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`; `~/.config/pnpm/config.yaml`: `minimumReleaseAgeExclude: ["@deslop/*"]`.
6. **T3.** `vp install -g t3@nightly`, `t3 service install`, `t3 connect link --headless`, `t3 connect publish`, `t3 browser setup`, `sudo hostnamectl set-hostname --pretty <name>`.
7. **Accounts.** Give the user each sign-in link: `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login`, `codex login --device-auth`, [AWS](dual.md#aws). Then `gh auth setup-git`, `gh extension install github/gh-stack`; clone both repositories; `t3 project add --title <name> <path>`; [agent links](#agent-configuration-links); [keyring and MCP](#keyring-and-mcp).
8. **Keys only**, once a key login from another machine succeeds: `/etc/ssh/sshd_config.d/10-keys-only.conf` with `UsePAM yes`, `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no`, `X11Forwarding no`; `sudo sshd -t`, then `sudo systemctl reload ssh`.

### Agent configuration links

Also after a harness replaced a link with a file. `~/.codex/skills` stays a real folder for Codex's `.system`.

```bash
r=~/deslop
mkdir -p ~/.claude/agents ~/.codex/rules ~/.codex/skills
ln -sfn $r/.claude/settings.json ~/.claude/settings.json
ln -sfn $r/.claude/agents/pair.md ~/.claude/agents/pair.md
[ -L ~/.claude/skills ] || mv ~/.claude/skills ~/.claude/skills.old 2>/dev/null
ln -sfn $r/.claude/skills ~/.claude/skills
find ~/.codex/skills -maxdepth 1 -type l -delete
ln -sfn ~/.claude/skills/* ~/.codex/skills/
ln -sfn $r/.codex/global-config.toml ~/.codex/config.toml
ln -sfn $r/.codex/instructions.md ~/.codex/instructions.md
ln -sfn $r/.codex/rules/deny.rules ~/.codex/rules/deny.rules
codex execpolicy check --rules ~/.codex/rules/deny.rules true
```

### T3 settings

After a change, copy them with `target=mp281x@<other worker>`:

```bash
q="SELECT project_id, workspace_root FROM projection_projects WHERE deleted_at IS NULL"
new=$(jq --argjson src "$(sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite "$q")" \
  --argjson dst "$(ssh "$target" "sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite '$q'")" \
  --argjson old "$(ssh "$target" 'cat ~/.t3/userdata/settings.json')" '
  ([$src[] | {key: .project_id, value: .workspace_root}] | from_entries) as $root
  | ([$dst[] | {key: .workspace_root, value: .project_id}] | from_entries) as $id
  | def remap: with_entries(select($id[$root[.key]] != null) | .key = $id[$root[.key]]);
  (. | del(.environmentIcon)) + ($old | {environmentIcon} | with_entries(select(.value != null)))
  | .projectSettingsOverrides |= ((. // {}) | remap)
  | .projectSettingsFolded |= ((. // {}) | if type == "object" then remap else . end)
' ~/.t3/userdata/settings.json) && ssh "$target" 'cat > ~/.t3/userdata/settings.json' <<<"$new"
```

Keep each project's `scripts` (`t3_project_update`) equal to `projectSettingsOverrides.<id>.defaultProjectScripts`; never edit `projectScriptOverrides`.

### Mac

`curl -fsSL https://vite.plus | bash`; `~/.zshenv` exports `PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` and `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`. Xcode: `open "macappstore://apps.apple.com/app/id497799835"`.

### Keyring and MCP

Gateway needs no login: Auth names the worker's tailnet owner.

```bash
sudo apt-get install -y gnome-keyring libsecret-tools
mkdir -p ~/.config/systemd/user ~/.local/share/dbus-1/services
printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
  "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
  'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
printf '%s\n' '[D-BUS Service]' 'Name=org.freedesktop.secrets' 'Exec=/bin/false' 'SystemdService=secret-service.service' \
  > ~/.local/share/dbus-1/services/org.freedesktop.secrets.service
busctl --user call org.freedesktop.DBus / org.freedesktop.DBus ReloadConfig
systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
claude mcp add --transport http --scope user gateway https://gateway.mp281x.xyz/mcp
```

### AWS CLI

AWS CLI v2's Linux x86_64 installer, with `--update` to update. Its sign-in is Dual's [AWS](dual.md#aws) session. `~/.aws/config`:

```ini
[sso-session datapizza]
sso_start_url = https://datapizza.awsapps.com/start
sso_region = eu-west-1
sso_registration_scopes = sso:account:access

[default]
sso_session = datapizza
sso_account_id = 736979665822
sso_role_name = DualosOperator
region = eu-south-1
```
