# Deploy

Resource history, running apps and HTTPS exposure for each worker.

```bash
npm install --global @deslop/deploy
deploy service install --url https://deploy.example.ts.net --workers desktop=https://desktop.example.ts.net:5102
```

- **`--workers`** names the other workers' Deploy; every worker keeps the same `DEPLOY_KEY` in `~/.deslop/deploy.env`.
- **Platforms.** Linux x64 and macOS arm64. Public exposure runs the bundled Caddy, a Linux x64 build, so a Mac exposes ports to the tailnet only; its apps are its `deslop-*` launch agents, measured without per-app history.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
