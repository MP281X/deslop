# Deploy

Resource history, running apps and HTTPS exposure for each worker.

```bash
npm install --global @deslop/deploy
deploy service install --domain mp281x.xyz --workers desktop,macbook-pro
```

- **`--workers`** lists Tailscale machine names. Deploy derives each HTTPS URL from the tailnet's MagicDNS suffix and its package port; every worker keeps the same `DEPLOY_KEY` in `~/.deslop/deploy.env`.
- **Platforms.** Linux x64 and macOS arm64. Public exposure runs the bundled Caddy, a Linux x64 build, so a Mac exposes ports to the tailnet only; its apps are its `deslop-*` launch agents, measured without per-app history.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
