# Maintenance

Setup, upkeep and rebuild of the machines. Do established upkeep without asking. Ask only for missing access, a new scope or an interruption of running work. Report failures, gaps and what Clean removed.

## Machines

The workers `dev` and `desktop` run the latest Debian stable in text mode with the same setup, as `mp281x` with passwordless sudo. Setup never copies sign-ins or machine configuration between machines; only the [T3 settings](#t3-settings) are shared.

| Fact      | `dev`                                                                            | `desktop`                                                       |
| --------- | -------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Hardware  | VPS, 8 cores, 23 GB, 15 GB swap                                                  | Ryzen 9 9900X, 30 GB, 31 GB swap, 1 TB NVMe                     |
| Network   | Always on, public `77.237.236.132`; ufw allows 80 and 443                        | On demand, home LAN on Ethernet `eno1`; ufw denies all incoming |
| Only here | Traefik for `*.mp281x.xyz`, the Datapizza VPN, Jaeger, the Mullvad media proxies | Nothing                                                         |
| GitLab    | Through the VPN; advertises the route to the tailnet                             | Through dev's route (`--accept-routes`)                         |

- **Sudo.** `/etc/sudoers.d/99-mp281x-nopasswd` (mode 0440) holds `mp281x ALL=(ALL:ALL) NOPASSWD: ALL`, because Codex and Claude run sudo without a terminal.
- **Toolchain.** Docker with Compose and Buildx, `gh` with the `github/gh-stack` extension, `glab`, `acli`, git, build tools, rsync, ripgrep, jq, sqlite3, lsof, ffmpeg, ImageMagick, Python with `python3-pil`, `dig` and `psql`; on dev also the standalone `yt-dlp` in `/usr/local/bin`. Vite+ in `~/.vite-plus` holds Codex and `t3@nightly`; Claude Code is in `~/.local/bin`. The first lines of `~/.bashrc`, above its interactive guard, put `$HOME/.local/bin:$HOME/.vite-plus/bin` on `PATH`.
- **Sign-ins.** Each worker signs in on its own with `gh auth login`, `glab auth login --hostname git.datapizza.tech`, `claude auth login` and `codex login --device-auth`; show each sign-in link to the user. `acli` follows [Jira sign-in](#jira-sign-in).
- **Repositories.** Identities follow [Git identity](#git-identity). `~/dual` uses the credential helper `!glab auth git-credential` for `https://git.datapizza.tech`; GitHub uses `gh auth setup-git`.
- **Automatic updates.** `unattended-upgrades` installs Debian updates daily (`/etc/apt/apt.conf.d/20auto-upgrades`). `desktop` gets only local IPv6 addresses, so its `/etc/apt/apt.conf.d/99force-ipv4` holds `Acquire::ForceIPv4 "true";`.
- **Git.** Global defaults: `rebase.updateRefs`, `rebase.autoSquash`, `rebase.autoStash`, `push.autoSetupRemote`, `fetch.prune`, `rerere.enabled`, `diff.algorithm histogram`, `merge.conflictStyle zdiff3` and `init.defaultBranch main`.
- **Media proxy.** On dev, the user unit template `deslop-wireproxy@<relay>` runs `~/.deslop/bin/wireproxy` (v1.1.3 from `windtf/wireproxy`) once per Mullvad relay, with `~/.deslop/wireproxy/<relay>.conf` and a SOCKS5 port from 1080 up on dev's tailnet address. `systemctl --user list-units 'deslop-wireproxy@*'` lists them. `~/.deslop/mullvad/<relay>.conf` (mode 0600) holds each relay's WireGuard file with the user's key, which works with every relay; never print these files. To replace a blocked relay, take its public key and address from `https://api.mullvad.net/www/relays/wireguard/`, write both files with the next free port, run `systemctl --user enable --now deslop-wireproxy@<relay>`, and update `STASH_MEDIA_PROXY` in `~/.deslop/stash.env`. A new worker needs a new Mullvad file from the user.
- **Firewall.** Tailscale's `ts-input` chain accepts tailnet traffic before ufw, so ufw needs no tailnet rule. On dev, `/etc/sysctl.d/90-quiet-console.conf` keeps `[UFW BLOCK]` lines off the VNC console.

## Access changes

- **Keys.** Every machine, the Mac included, holds the user's one ED25519 key pair as `~/.ssh/id_ed25519`, and `authorized_keys` holds only its public key. The user gives the pair to a new or reset machine. No machine has a `~/.ssh/config` or other keys. Each worker's `known_hosts` comes from `ssh-keyscan -H dev desktop macbook-pro`.
- **Before locking.** Turn off a login method only after a login by the remaining method succeeded from another machine.
- **Names.** T3 shows the `PRETTY_HOSTNAME` as the environment name. Set it to the Tailscale name with `sudo hostnamectl set-hostname --pretty <name>`, and restart T3.

## Agent configuration

Every worker runs the same agent configuration from the deslop repository. After each change to the sources, install from the checkout that holds the change on every running worker. Report an unreachable worker as a gap unless the user turned it off; it gets the install when it runs again.

- **Sources.** `.claude/settings.json`, `.claude/agents/pair.md`, `.codex/config.toml`, `.codex/instructions.md` and `.codex/rules/deny.rules` own the base configuration. Personal skills remain in `.claude/skills/{orchestrator,delivery,explore,environment}/`; Codex links to them. Architecture, engineering, design, testing and review belong to coding-standards and install into repositories, not global configuration.
- **Origin.** Install only from main or from a branch with an open pull request, and bring every installed change to main.
- **Before writing.** Run `diff -r` between the source and each installed copy. A difference that neither your branch nor `origin/main` made comes from another branch: bring it into your branch first, never overwrite it. Evaluation preparation follows its package's Run contract instead.

```bash
set -e
for worker in dev desktop; do
  t=mp281x@$worker
  ssh -o ConnectTimeout=5 $t true || { echo "$worker is unreachable"; continue; }
  for s in orchestrator delivery explore environment; do rsync -a --delete --mkpath .claude/skills/$s/ $t:.claude/skills/$s/; done
  rsync -a .claude/settings.json $t:.claude/settings.json
  rsync -a --mkpath .claude/agents/pair.md $t:.claude/agents/pair.md
  rsync -a --mkpath .codex/config.toml .codex/instructions.md $t:.codex/
  rsync -a --mkpath .codex/rules/deny.rules $t:.codex/rules/deny.rules
  ssh $t 'mkdir -p ~/.codex/skills && for s in orchestrator delivery explore environment; do ln -sfn ~/.claude/skills/$s ~/.codex/skills/$s; done'
done
```

The settings turn off claude.ai skill and plugin sync. After a rename or move into coding-standards, compare the obsolete global copy with its old approved source before removing only that owned directory and its Codex link. Keep the legacy global review skill until every active project that relies on it has its shared replacement installed and verified. Use each project's owner or setup procedure; never edit another thread's checkout to finish the migration. Preserve unrelated skills and plugins. New sessions load the change; running threads keep their version. Verify with the same `diff -r`, check that each worker's sign-ins work, and run `codex execpolicy check --rules ~/.codex/rules/deny.rules true`, which fails when a rule's examples no longer match.

## T3 settings

All workers use the same T3 settings. After the user changes a setting on one worker, run the block below there with `target=mp281x@<other worker>`. It maps project keys by workspace root and keeps the target's `environmentIcon`. T3 reloads the file without a restart.

```bash
d=$(mktemp -d /tmp/t3-settings-XXXX)
q="SELECT project_id, workspace_root FROM projection_projects WHERE deleted_at IS NULL"
sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite "$q" > $d/src-projects.json
ssh "$target" "sqlite3 -readonly -json ~/.t3/userdata/statev2.sqlite '$q'" > $d/dst-projects.json
ssh "$target" 'cat ~/.t3/userdata/settings.json' > $d/dst-settings.json
jq --slurpfile src $d/src-projects.json --slurpfile dst $d/dst-projects.json --slurpfile old $d/dst-settings.json '
  ([$src[0][] | {key: .project_id, value: .workspace_root}] | from_entries) as $root
  | ([$dst[0][] | {key: .workspace_root, value: .project_id}] | from_entries) as $id
  | def remap: with_entries(select($id[$root[.key]] != null) | .key = $id[$root[.key]]);
  (. | del(.environmentIcon)) + ($old[0] | {environmentIcon} | with_entries(select(.value != null)))
  | .projectScriptOverrides |= ((. // {}) | remap)
  | .projectSettingsOverrides |= ((. // {}) | remap)
  | .projectSettingsFolded |= ((. // {}) | if type == "object" then remap else . end)
' ~/.t3/userdata/settings.json > $d/new-settings.json
ssh "$target" 'cat > ~/.t3/userdata/settings.json' < $d/new-settings.json
rm -rf $d
```

**Claude launch arguments.** `providerInstances.claudeAgent.config.launchArgs` is `--system-prompt-snapshot off --thinking-display omitted --autocompact 500k`. These keep prompt updates visible, hide thinking summaries and select a 500k compaction window. Claude reserves a buffer inside that window; this is not a promise to reach exactly 500,000 tokens before compaction. Keep the custom pair prompt and `ENABLE_TOOL_SEARCH=false`.

Change only this provider's compaction flag on each running worker; preserve other launch arguments, providers, sign-ins and thread selections. T3 passes the flag to fresh Claude processes, including resumed sessions. Do not stop active threads or restart T3 to force the change into an existing process. Verify the configured arguments and run Claude's local `/context` command with them; it must show the 500k window with zero model turns. A later real compaction is required to measure summary quality and net usage savings.

The copy carries project scripts, such as Dual's worktree script `vp install --frozen-lockfile && vpx @deslop/coding-standards@latest`. Check them on the target with `t3_project_list`.

**Review guides.** `reviewGuidesEnabled` is `true`, `reviewGuideModelSelection` is Codex `gpt-6.1-sol`, and `reviewGuideInstructions` holds exactly this text:

```text
The reader is a tired reviewer who wants to finish fast and must not miss a risk.
Open with the stop that can break something: a migration, a changed contract or schema, a permission change, removed behavior or a new dependency. Put the risk in its attention note.
Then follow what a user or caller sees change, then the interfaces, then the implementation.
Spend words only on choices a maintainer must agree with: a new abstraction, option, fallback, retry, special case, compatibility alias or comment. Name each one and ask whether the change needs it.
Put generated files, lockfiles, formatting, renames and moves in one closing skim stop.
Use at most five stops of two short sentences each, in plain words. No praise, no restated diff, no test counts or pipeline results.
```

## Update and deploy

1. **Update.** Run `sudo apt-get update`, `sudo apt-get upgrade -y`, `sudo apt-get autoremove -y`, `sudo apt-get clean` and `vp upgrade`; on dev also `sudo yt-dlp -U`. glab has no apt repository: when `curl -fsSL https://gitlab.com/api/v4/projects/gitlab-org%2Fcli/releases/permalink/latest` names a newer `tag_name`, install its `glab_<version>_linux_amd64.deb`.
2. **T3.** Each worker runs T3's nightly channel as the `t3code.service` user unit: `vp install -g t3@nightly` and `t3 service install`. Run `t3 connect link --headless` and show its sign-in link to the user. Run `t3 connect publish` for push notifications and Live Activities, then `t3 service restart` with no run active. The user turns on **Device Notifications** once per device in the app's settings.
3. **Deploy.** On dev, from `~/deslop` on published main, run `docker compose --project-name deslop --file tools/compose.yaml pull`, then `up -d --remove-orphans`. A changed inline config needs `up -d --force-recreate --no-deps <service that mounts it>`.
4. **Verify.** https://portfolio.mp281x.xyz and dev's http://127.0.0.1:16686/api/services return 200, and an OPTIONS preflight to otel's `/v1/traces` and `/v1/logs` with `Origin: https://portfolio.mp281x.xyz` succeeds.
5. **Tailscale.** On a new machine, run the block below and show the sign-in URL of `tailscale up` to the user; he then disables key expiry at https://login.tailscale.com/admin/machines. With the Datapizza VPN, the machine advertises the VPN's route to GitLab, and the user approves it on the same page.

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

Remove rebuildable data, never unsettled work. A worktree is disposable only when every thread that owns it is settled, no run is queued and no process uses it; waiting for the user is not settled. Two threads can share one worktree and its preview stage.

Find owners with T3's thread tools or explore's T3 history procedure: `orchestration_v2_projection_threads.payload_json` holds `worktreePath`, `settledAt` and `settledOverride`, and each owner's latest `orchestration_v2_projection_runs` row shows activity. A missing path, listener or row starts an investigation, never a deletion. Unknown owners, stopped containers, unattached volumes and the production `deslop` project stay.

1. **Removed worktrees.** Find Compose projects whose `com.docker.compose.project.working_dir` is gone, processes with a deleted working directory, Serve mappings without a backend, and `~/.deslop/<worktree>` folders without a checkout. When every owner is settled, remove that project (`down --volumes --remove-orphans`), process group, mapping (`sudo tailscale serve --https=<port> off`) or folder. Keep `~/.deslop/deploy`.
2. **Settled worktrees.** T3 removes worktrees 4 days after their last run and when their pull request merges. Before that, destroy a settled worktree's disposable Alchemy preview or Compose project. Run `git worktree remove --force --force <path>` only on a clean worktree, and list dirty ones for the user. Delete `~/.deslop/<worktree directory name>/`.
3. **Local branches.** In `~/deslop` and `~/dual`, delete local branches that no worktree uses once their pull request merged. A stack's published branches are not checked out, so an open or closed pull request keeps its branch. List branches without a merged or open pull request for the user.

   ```bash
   git fetch -q --prune origin
   used=$(git worktree list --porcelain | awk '/^branch /{sub("refs/heads/","",$2); print $2}')
   default=$(git symbolic-ref --short refs/remotes/origin/HEAD | sed 's|origin/||')
   for b in $(git for-each-ref --format='%(refname:short)' refs/heads); do
     [ "$b" = "$default" ] && continue
     echo "$used" | grep -qx "$b" && continue
     if git remote get-url origin | grep -q github.com; then state=$(gh pr list --head "$b" --state all --json state -q '.[0].state')
     else state=$(glab mr list --source-branch "$b" --all -F json | jq -r '.[0].state // empty'); fi
     case "$state" in
       MERGED|merged) git branch -D "$b" >/dev/null && echo "deleted $b" ;;
       OPEN|opened) ;;
       *) echo "keep $b: ${state:-no pull request}" ;;
     esac
   done
   ```

   T3 reads the checkpoint refs under `refs/t3/orchestration-v2/` and never deletes them. Delete the legacy ones: `git for-each-ref --format='delete %(refname)' refs/t3/checkpoints | git update-ref --stdin`.

4. **`/tmp`.** systemd cleans it per [Scratch on disk](#scratch-on-disk). Remove a large folder earlier only when its owner is settled and nothing holds it open (`lsof +D`). Keep `claude-*` and `codex*` session folders.
5. **Caches.** With no build running, run `docker image prune -a -f` and `docker builder prune -a -f`. With no install running, run `vp pm cache clean` in `~/deslop` and `~/dual`, and clear identified caches under `~/.npm` and `~/.cache`. Remove Vite+, Node, package-manager, Codex and Claude Code versions that are not current and that no process uses. Run `journalctl --vacuum-size=100M`. Never run a blanket Docker system or volume prune or a negated-label exclusion.
6. **T3 releases.** Skip this step while `~/.t3/runtime/service-state.json` shows an update that is not `committed`. After T3 updates itself, the unit's launcher stays on the old version and `t3 service status` reports a repair. Install the CLI at the active version with `vp install -g t3@<active version>`. With no run active, run `t3 service install`, which restarts T3. With runs active, point `ExecStart` in `~/.config/systemd/user/t3code.service` at the active version and run `systemctl --user daemon-reload`. Then delete the versions that no process uses.
7. **Report.** Show `df -h /` before and after, what each step removed, and the ten largest folders left (`du -xh --max-depth=2 ~ /tmp /var/lib/docker | sort -h | tail`). Count all worktrees' `node_modules` in one `du`, because installs hardlink from the stores.

## Docker binding defaults

`/etc/docker/daemon.json` binds new bridge and legacy-bridge publishes to loopback, and live restore keeps containers running through daemon restarts. Explicit publishes override the defaults; production 80 and 443 bind both address families on purpose.

```json
{
	"live-restore": true,
	"ip": "127.0.0.1",
	"default-network-opts": {"bridge": {"com.docker.network.bridge.host_binding_ipv4": "127.0.0.1"}}
}
```

## Set up a worker

Start from a Debian netinst image, and select only the SSH server task.

1. Install `sudo`, `network-manager` and `ufw`, and mark them as manual. Put `/tmp` on disk per [Scratch on disk](#scratch-on-disk). Purge any desktop stack with `--autoremove`: the `task-*desktop` tasks, GNOME, GDM, LibreOffice, Firefox, Evolution, CUPS, Avahi, BlueZ, ModemManager and PipeWire. Keep `multi-user.target` as the default target.
2. Write the sudoers file. Add the Docker, GitHub CLI and `acli` apt sources with each key in `/etc/apt/keyrings/<name>.gpg`. Install the toolchain, `glab` and `unattended-upgrades` with its `20auto-upgrades` file. Set the git defaults. Add `mp281x` to the `docker` group, and write the Docker binding defaults.
3. Install the user's key pair per [Access changes](#access-changes). Run the Tailscale block. After a second SSH login over the tailnet works, set `ufw default deny incoming`, allow 80 and 443 only on dev, and enable ufw.
4. On dev only: install `openvpn3-client` from the OpenVPN 3 apt source, import the VPN with `openvpn3 config-import --config <datapizza.ovpn> --name datapizza --persistent`, connect it, and advertise its route.
5. Run `loginctl enable-linger mp281x`. As `mp281x`, install Vite+ with `VP_HOME="$HOME/.vite-plus"`, the global packages and Claude Code. Put `export PATH="$HOME/.local/bin:$HOME/.vite-plus/bin:$PATH"` at the top of `~/.bashrc`, and check `ssh <worker> 'command -v vp claude codex'`. Write `~/.config/pnpm/config.yaml` with `minimumReleaseAgeExclude: ["@deslop/*"]`, so `vpx @deslop/<package>@latest` gets same-day releases. Run the T3 step and `t3 browser setup`, and set `PRETTY_HOSTNAME`.
6. Run the sign-ins, the [Jira sign-in](#jira-sign-in) and `gh extension install github/gh-stack`. Write the git identities per [Git identity](#git-identity). Clone both repositories and add each with `t3 project add --title <name> <path>`. From a thread on that worker, give each project a worktree script with `t3_project_update`: `vp install --frozen-lockfile`, and for Dual also `vpx @deslop/coding-standards@latest`. On dev, deploy the public apps.
7. Install the [agent configuration](#agent-configuration), and copy the [T3 settings](#t3-settings) from another worker.
8. After a key login from another machine succeeds, write `/etc/ssh/sshd_config.d/10-keys-only.conf` with `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no` and `X11Forwarding no`, then run `sudo sshd -t && sudo systemctl reload ssh`.

## Mac

The Mac runs T3's desktop app and the iOS Simulator, which T3's device tools drive over SSH from a worker. It builds nothing: the simulator app comes from CI, with the JavaScript bundle that the worker exports.

- **Owner.** The user's organization manages it through MDM: updates, FileVault, the firewall and power settings. Keep those policies.
- **On demand.** System sleep is off (`pmset` sleep 0), so the Mac stays reachable with its display off. A closed lid or the Sleep command makes it unreachable. When `ssh matteopaludgnach@macbook-pro true` fails, ask under **Needs you** to wake it.
- **Agents.** Set up the device host below, run `vp upgrade` and `softwareupdate -l`, and clean user caches, such as unused simulators with `xcrun simctl delete unavailable`. Install no Homebrew, worker configuration, git tools, sign-ins or repository clones. Leave its Claude and Codex homes to the user.
- **User.** Sudo needs his password, so he installs apps, macOS updates, permissions and sign-ins himself, from a guide.

### Device host

1. Install Vite+ with `curl -fsSL https://vite.plus | bash`, which brings the Node that T3's device helpers need. Write `~/.zshenv` with `export PATH="$HOME/.vite-plus/bin:$PATH"` and `export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer`, because SSH commands read only that file.
2. Open Xcode's App Store page with `open "macappstore://apps.apple.com/app/id497799835"`. Give the user a guide: click Get, open Xcode once, accept the license and download the iOS platform.
3. Check over SSH that `xcrun simctl list runtimes` lists iOS and that `node --version` is 22.12 or newer. Boot the iPhone Air simulator once with `xcrun simctl boot <udid>`, because T3 lists only simulators that ran.
4. Give the user a guide: in T3's Settings, Integrations, Devices, select the worker's environment, turn on Device hub and Agent device access, add the host `matteopaludgnach@macbook-pro` and test the connection. Copy the result to the other worker per [T3 settings](#t3-settings).

## Jira sign-in

Agents read Dual's Jira and assign approved tickets through `acli` per [Dual](dual.md#jira). Its apt source updates it with [Update and deploy](#update-and-deploy), not with the daily Debian upgrades.

```bash
curl -fsSL https://acli.atlassian.com/gpg/public-key.asc | sudo gpg --batch --yes --dearmor -o /etc/apt/keyrings/acli.gpg
echo "deb [arch=amd64 signed-by=/etc/apt/keyrings/acli.gpg] https://acli.atlassian.com/linux/deb stable main" | sudo tee /etc/apt/sources.list.d/acli.list
sudo apt-get update && sudo apt-get install -y acli
```

- **Secret Service.** `acli` keeps its token in a Secret Service. On a headless worker, the `secret-service` user unit runs `gnome-keyring-daemon`, unlocked at start with a fixed password.

  ```bash
  sudo apt-get install -y --no-install-recommends gnome-keyring libsecret-tools
  mkdir -p ~/.config/systemd/user
  printf '%s\n' '[Unit]' 'Description=Secret Service for headless CLI sign-ins' '[Service]' \
    "ExecStart=/bin/sh -c 'printf headless | exec /usr/bin/gnome-keyring-daemon --foreground --replace --unlock --components=secrets'" \
    'Restart=on-failure' '[Install]' 'WantedBy=default.target' > ~/.config/systemd/user/secret-service.service
  systemctl --user daemon-reload && systemctl --user enable --now secret-service.service
  ```

- **Sign in.** `acli` uses a classic API token without scopes. Give the user a guide: create the token at https://id.atlassian.com/manage-profile/security/api-tokens with a one-year expiry, then run the command below in the T3 terminal of each worker, paste the token and press Enter.

  ```bash
  read -rs t && echo "$t" | acli jira auth login --site datapizza.atlassian.net --email matteopaludgnach@datapizza.tech --token; unset t
  ```

- **Renew.** When `acli jira auth status` fails, give the user the same guide with a new token.

## Git identity

Git picks the identity from the remote, so repositories and worktrees carry no `user.*`.

| Remote host          | Name                | Email                             |
| -------------------- | ------------------- | --------------------------------- |
| `github.com`         | `MP281X`            | `dev@mp281x.xyz`                  |
| `git.datapizza.tech` | `Matteo Paludgnach` | `matteopaludgnach@datapizza.tech` |

```bash
mkdir -p ~/.config/git
printf '[user]\n\tname = MP281X\n\temail = dev@mp281x.xyz\n' > ~/.config/git/github.gitconfig
printf '[user]\n\tname = Matteo Paludgnach\n\temail = matteopaludgnach@datapizza.tech\n' > ~/.config/git/datapizza.gitconfig
for u in 'https://github.com/**' 'git@github.com:**' 'ssh://git@github.com/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/github.gitconfig; done
for u in 'https://git.datapizza.tech/**' 'git@git.datapizza.tech:**' 'ssh://git@git.datapizza.tech/**'; do git config --global "includeIf.hasconfig:remote.*.url:$u.path" ~/.config/git/datapizza.gitconfig; done
```

## Scratch on disk

Debian mounts `/tmp` as tmpfs in RAM; the workers mask that mount, and systemd cleans the disk directory. The change applies at the next boot, and `findmnt /tmp` then prints nothing.

```bash
printf '# /tmp lives on disk; empty it at boot and drop files unused for 7 days\nD /tmp 1777 root root 7d\n' | sudo tee /etc/tmpfiles.d/tmp.conf >/dev/null
sudo systemctl mask tmp.mount
```
