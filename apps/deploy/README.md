# Deploy

Resource history, running apps and HTTPS exposure for each worker.

```bash
npm install --global @deslop/deploy
deploy service install --url https://deploy.example.ts.net --workers desktop=https://desktop.example.ts.net:5102
```

- **`--workers`** names the other workers' Deploy; every worker keeps the same `DEPLOY_KEY` in `~/.deslop/deploy.env`.
- **Public exposure** runs its bundled Caddy on ports 80 and 443.
- **MCP** at `/mcp`: `resource_history`, `inventory`, `expose_port`, `hide_exposure`.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
