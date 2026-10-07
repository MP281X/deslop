# Desktop

`desktop` is the user's home workstation: an ASUS ROG Strix B650E-I board with a Ryzen 9 9900X. It has 30 GB of RAM, an RTX 5070 and a 1 TB NVMe. It runs Debian 13 in text mode, with no monitor and no desktop environment.

## Access

- **Network.** Only Ethernet (`eno1`) carries traffic, with DHCP through NetworkManager. The Wi-Fi radio is off, and the antenna is absent.
- **Firewall.** ufw denies all incoming traffic. Tailscale accepts tailnet traffic before ufw, so SSH answers only on the tailnet as `desktop`. T3 also accepts signed-in T3 Connect clients through its managed tunnel.
- **SSH.** `mp281x` logs in with the user's two ED25519 keys, the same keys that dev accepts. Password login, root login and X11 forwarding are off.
- **Password.** The account password works only at the physical console. Sudo needs no password, as on dev.
- **T3.** The `t3code.service` user unit runs T3 nightly, and lingering starts it at boot. T3 Connect carries the connection and publishes agent activity for push notifications.
- **GitLab.** `tailscale set --accept-routes` sends `git.datapizza.tech` through the route that dev advertises. When the VPN on dev expires, GitLab fails here as well. Ask the user to reconnect it from a dev thread.
- **Wake-on-LAN.** The firmware and `eno1` accept magic packets, so a device on the home LAN can start the machine. The Ethernet address is `60:cf:84:e9:44:55`.

## Toolchain

`desktop` has the dev toolchain without the VPN client, the production containers and Jaeger.

| Area         | Installed                                                                                                                    |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Apt sources  | Debian with `contrib` and `non-free`, Docker, GitHub CLI, Atlassian CLI, NVIDIA CUDA, NVIDIA container toolkit and Tailscale |
| Packages     | Docker with Compose and Buildx, `gh`, `glab`, `acli`, git, build tools, ripgrep, jq, sqlite3, ffmpeg and Python              |
| Vite+        | `vp` with Codex, agent-browser and `t3@nightly` as global packages, and Chrome for agent-browser                             |
| Claude Code  | The native installer in `~/.local/bin`                                                                                       |
| Repositories | `~/deslop` and `~/dual`, with the same identities and credential helpers as on dev                                           |

- **glab.** glab has no apt repository, so maintenance installs its latest release package.
- **Sign-ins.** `gh` and `glab` use copies of dev's static tokens. Claude Code and Codex have their own sign-ins, because copied subscription logins break when one machine refreshes them.
- **Docker.** `/etc/docker/daemon.json` has dev's loopback binding defaults plus the `nvidia` runtime.

## GPU

NVIDIA's Debian 13 repository supplies `nvidia-open`, which builds the open kernel modules through DKMS. Secure Boot is on. The kernel loads the modules only after the user enrolls the DKMS signing key. Enrollment needs a monitor and a keyboard once:

1. Run `sudo mokutil --list-new`. When it lists no key, run `sudo mokutil --import /var/lib/dkms/mok.pub` and choose a one-time password.
2. Reboot. In the blue MOK manager, choose **Enroll MOK**, **Continue** and **Yes**, type the password, and reboot.
3. Check that `nvidia-smi` lists the RTX 5070, and that `docker run --rm --gpus all debian nvidia-smi` does too.

A reboot without a keyboard skips the MOK manager and drops the pending key. Until enrollment, `nvidia-persistenced` and `nvidia-cdi-refresh` fail, and `systemctl is-system-running` reports `degraded`.

## Rebuild

These steps rebuild `desktop` from a Debian 13 netinst image. Select only the SSH server task in the installer, because the desktop tasks install GNOME.

1. Install `sudo`, `network-manager` and `ufw`, and mark them as manual. Then purge any desktop stack with `--autoremove`: the `task-*desktop` tasks, GNOME, GDM, LibreOffice, Firefox, Evolution, CUPS, Avahi, BlueZ, ModemManager and PipeWire.
2. Keep `multi-user.target` as the default target. Write `/etc/sudoers.d/99-mp281x-nopasswd` with mode 0440: `mp281x ALL=(ALL:ALL) NOPASSWD: ALL`. Codex and Claude run sudo without a terminal.
3. Add the apt sources from the toolchain table, each key in `/etc/apt/keyrings/<name>.gpg`, and install the packages. Install `linux-headers-amd64`, `nvidia-open` and `nvidia-container-toolkit`, then add `mp281x` to the `docker` group.
4. Write the Docker binding defaults from [maintenance](maintenance.md#docker-binding-defaults), then run `nvidia-ctk runtime configure --runtime=docker` and restart Docker.
5. Run `sudo tailscale up --accept-routes` and show its sign-in link to the user. After a second SSH login over the tailnet works, turn off the Wi-Fi radio, set `ufw default deny incoming` and enable ufw.
6. Run `loginctl enable-linger mp281x`. As `mp281x`, create `~/.deslop` for the heavy-command lock, and install Vite+, the global packages and Claude Code. Run `agent-browser install --with-deps` and `t3 service install`.
7. Run `t3 connect link --headless` and show its device sign-in link to the user. Then run `t3 connect publish` and `t3 service restart`, because T3 reads the link at startup.
8. Copy dev's `gh` and `glab` token files, run `gh auth setup-git`, and clone both repositories with their identities. Add each with `t3 project add --title <name> <path>`. The user signs in to Claude Code and Codex from a T3 terminal.
9. Install the personal configuration through the [Deslop](deslop.md#install-personal-configuration) procedure.
10. After the user's key login works, write `/etc/ssh/sshd_config.d/10-keys-only.conf` with `PasswordAuthentication no`, `KbdInteractiveAuthentication no`, `PermitRootLogin no` and `X11Forwarding no`. Run `sudo sshd -t && sudo systemctl reload ssh`, and check `sudo sshd -T`.
11. Enroll the GPU key the next time a monitor and a keyboard are connected.
