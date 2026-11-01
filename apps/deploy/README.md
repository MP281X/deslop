# Deploy

System monitoring and application endpoints across the workers. Scope remains the Effect trace/log application. Alchemy deployments, maintenance-agent spawning and tailnet membership administration are separate, not implemented capabilities.

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

The Apps page puts exposure controls at the top. Pick an unexposed HTTP listener belonging to a visible app, not an OS daemon; a bounded loopback HEAD request identifies HTTP and prefers the app's HTML endpoint over internal tool/debug ports. Owned and observed tailnet/public backends are excluded from the picker. Probes never follow redirects or send credentials. Tailnet DNS is derived from that worker. Tailnet and Public keep the same input row and height; selecting Public and submitting confirms public access without a second checkbox. The HTTP MCP still requires `publicAccess=true` for machine callers. Stale, UDP, privileged and non-IPv4-loopback-reachable listeners are excluded because both proxies target `127.0.0.1`. This publishes HTTP backends, not arbitrary TCP protocols.

Each application row shows a machine icon, type icon, status dot, host-port pills and linked HTTPS endpoints. Listeners join their systemd unit through `/proc/<pid>/cgroup`; Docker's published host bindings join containers to endpoints. Traefik Host rules are observed links, not Deploy-owned routes; its configured internal backend ports are not listening host sockets or row pills. Unmatched listeners remain separate rather than guessing ownership. Image tags, peer records and raw source output are not application details. All services includes background services and unmatched endpoints; Apps keeps app/user services, running/problem containers and failures. The machine filter scopes both pages and app selection, and stays in the URL across navigation. Changes go through the configured worker's authenticated RPC, never a request-supplied worker URL.

## Resource history

The separate Monitor page is a dense machine view: CPU history and each logical core, CPU model/load/uptime, RAM history with available/cache/buffer details, swap capacity, mounted storage and network/disk I/O histories. Stable colored device icons identify workers in both pages. Endpoint pills use the same Badge primitive as Auth; protocol labels and repeated hostnames are not row content.

The native agent samples every 30 seconds, independently of open browsers. CPU utilization, individual cores, available-memory-based RAM usage, swap, mounted-filesystem capacity, physical-interface receive/send rates and whole-disk read/write rates persist in hourly Effect KeyValueStore buckets for seven days. No database or monitoring daemon dependency. `DEPLOY_DATA` isolates history along with proxy configuration. Browser ranges are 1h, 24h and 7d; responses retain the last real sample per time bucket, bounded to 481 points per machine, not invented backfill or averages. Charts use the actual recording coverage within that range and label time/scale instead of leaving a new agent at the far edge of an empty week. CPU/rates are absent on startup, a counter reset or a sampling gap above 90 seconds; offline workers retain last-known data clearly marked stale.

Network totals include Linux `eth*`, `en*` and `wl*` interfaces, excluding loopback, VPN and Docker bridges to avoid double counting. Disk I/O includes whole `sd*`, `vd*`, `hd*` and NVMe disks, not partitions. Storage's chart is `/`; capacity values include other disk-backed mounts. History starts when the native agent runs on that machine; installing only the control plane cannot collect a remote machine's CPU or memory.

## HTTPS exposure

- **Tailnet:** uses this worker's real Tailscale DNS name and `tailscale serve --bg`. No Funnel, node enrollment, ACL edits, resets or takeover of existing mappings. Removal refuses a mapping that changed outside Deploy.
- **Public:** explicit public-access confirmation, validated hostname, loopback-only backend and an exclusively owned Caddyfile. Caddy has a separate loopback admin listener on 20219. DNS and inbound 80/443 must already reach the worker, and no other proxy may own those listeners. Deploy does not replace running Traefik or alter host firewall/privileged-port policy automatically.
- **Ownership:** only records Deploy created can be removed. An interrupted/failed apply retains its intent so it can be inspected and removed; “configured” does not assert TLS issuance or backend reachability. Configure the backend's canonical `--url` and authentication separately.

Host adapters use the worker's existing `systemctl`, `ss`, Docker and Tailscale clients/daemons and their permissions. Missing tools, an unavailable daemon or denied access are visible per source; they do not erase other inventory. The npm package is the host-agent install. The container counterpart needs no host sockets by default and can act as a control plane for native workers; it cannot magically control host systemd/Tailscale from an isolated container.

Data and owned configuration use `~/.deslop/deploy/` (`DEPLOY_DATA` overrides inventory/proxy storage for isolated tests). Removing the Deploy service retains data and existing exposures; remove owned exposures before uninstalling if they should stop too.
