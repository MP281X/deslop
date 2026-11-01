# Deploy

One service view across the workers: systemd services, Docker containers, TCP/UDP listeners, tailnet peers and HTTPS exposure. Scope remains the Effect trace/log application; this initial Deploy core is live inventory and owned proxies, not historical CPU/memory/storage metrics, Alchemy deployments, maintenance-agent spawning or tailnet membership administration.

```bash
vp install -g @deslop/deploy
deploy --port 5200
deploy service install --port 5200
```

CLI flags, optional Auth/traces, HTTP MCP, worker credentials and automatic self-update are described in the [shared runtime guide](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).

## Workers

Run Deploy on each worker. The control plane reads `DEPLOY_WORKERS` from its environment (for a service, `~/.deslop/deploy.env`):

```dotenv
DEPLOY_WORKERS=[{"name":"desktop","url":"https://desktop.tailnet-8c4c.ts.net:5200","auth":"https://auth.mp281x.xyz"}]
```

Worker URLs use HTTPS except loopback tests. Sign the control-plane CLI in to each protected worker with `deploy login --url <worker origin> --auth <issuer>`; it reuses those resource-bound credentials. Each worker snapshot is local only, so a control-plane/worker cycle cannot recursively duplicate the fleet. RPC is schema-binary over WebSocket. Failed workers retain their last successful rows marked stale, with a source error instead of a healthy empty list.

Select a port to prefill an exposure on that port's worker. The worker appears only where placement matters, not as a dashboard hierarchy. Changes go through the configured worker's authenticated RPC; arbitrary request-supplied worker URLs are not accepted.

## HTTPS exposure

- **Tailnet:** uses this worker's real Tailscale DNS name and `tailscale serve --bg`. No Funnel, node enrollment, ACL edits, resets or takeover of existing mappings. Removal refuses a mapping that changed outside Deploy.
- **Public:** explicit public-access confirmation, validated hostname, loopback-only backend and an exclusively owned Caddyfile. Caddy has a separate loopback admin listener on 20219. DNS and inbound 80/443 must already reach the worker, and no other proxy may own those listeners. Deploy does not replace running Traefik or alter host firewall/privileged-port policy automatically.
- **Ownership:** only records Deploy created can be removed. An interrupted/failed apply retains its intent so it can be inspected and removed; “configured” does not assert TLS issuance or backend reachability. Configure the backend's canonical `--url` and authentication separately.

Host adapters use the worker's existing `systemctl`, `ss`, Docker and Tailscale clients/daemons and their permissions. Missing tools, an unavailable daemon or denied access are visible per source; they do not erase other inventory. The npm package is the host-agent install. The container counterpart needs no host sockets by default and can act as a control plane for native workers; it cannot magically control host systemd/Tailscale from an isolated container.

Data and owned configuration use `~/.deslop/deploy/` (`DEPLOY_DATA` overrides inventory/proxy storage for isolated tests). Removing the Deploy service retains data and existing exposures; remove owned exposures before uninstalling if they should stop too.
