# Deploy

Resource history, running apps and HTTPS exposure for each worker.

```bash
npm install --global @deslop/deploy
deploy service install --domain mp281x.xyz --workers desktop,macbook-pro
```

- **`--workers`** lists Tailscale machine names. Deploy derives each HTTPS URL from the tailnet's MagicDNS suffix and its package port. Auth identifies peers by their tailnet owner; local commands require an admin.
- **Platforms.** Linux x64 and macOS arm64. Public exposure runs the bundled Caddy, a Linux x64 build, so a Mac exposes ports to the tailnet only. Its apps are running Dock applications and user launch agents, with process trees and listeners but no per-app history, read without additional macOS permissions.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
