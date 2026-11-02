# Deploy

System monitoring and application endpoints across the workers. Scope remains the Effect trace/log application. Alchemy deployments, maintenance-agent spawning and tailnet membership administration are separate, not implemented capabilities.

```bash
npm install --global @deslop/deploy
deploy service install --url https://deploy.example.ts.net --auth https://auth.mp281x.xyz --workers desktop=https://desktop.tailnet-8c4c.ts.net:5102
```

Flags, Auth, traces, HTTP MCP and updates are described in the [shared runtime guide](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).

## Workers

Run Deploy on each worker. The control plane names the others with `--workers name=origin,…`, and every worker holds the same `DEPLOY_KEY` in `~/.deslop/deploy.env`: Deploys send it as their bearer and accept a peer's, on any network. Worker URLs use HTTPS except loopback tests. Each worker snapshot is local only, so a control-plane/worker cycle cannot recursively duplicate the fleet. RPC is schema-binary over WebSocket. Failed workers retain their last successful rows marked stale, with a source error instead of a healthy empty list.

The Apps page puts exposure controls at the top. Pick an unexposed HTTP listener belonging to a visible app, not an OS daemon; a bounded loopback HEAD request identifies HTTP and prefers the app's HTML endpoint over internal tool/debug ports. Owned and observed tailnet/public backends are excluded from the picker. Probes never follow redirects or send credentials. Tailnet DNS is derived from that worker. Tailnet and Public keep the same input row and height; selecting Public and submitting confirms public access without a second checkbox. The HTTP MCP still requires `publicAccess=true` for machine callers. Stale, UDP, privileged and non-IPv4-loopback-reachable listeners are excluded because both proxies target `127.0.0.1`. This publishes HTTP backends, not arbitrary TCP protocols.

Application rows show transparent marks, CPU/resident memory, a machine icon, status dot and linked endpoints in shared columns. Deslop marks come from canonical artwork; known software uses SVGL's shadcn registry, with a generic mark when unavailable. Display names omit service decorations and shorten unique fragments to seven characters without changing identifiers. Picker names ellipsize. Listeners join systemd units through `/proc/<pid>/cgroup`; Docker host bindings join containers to endpoints. Traefik Host rules are observed links, not owned routes or host sockets. Apps keeps user services, running/problem containers and failures, not nameless listeners and ordinary system daemons. The URL machine filter scopes both pages and the picker. Context controls stay above scrolling results. Mutations use the configured worker's authenticated RPC, never a request-supplied URL.

Click a whole application row to reveal condensed descendants together: single-child wrappers collapse, identical leaf siblings group, and indentation stops at two levels. Each group owns disjoint processes; main rows show the app total, with CPU as a share of machine capacity and summed resident memory. A partial CPU reading uses ≥, not a fabricated total. Count top-level apps, not descendants. `/proc` status, stat and cgroup records are indexed for ownership and PID/start-time-safe CPU deltas, with baselines at least two seconds apart even across callers. No command lines or environments; inaccessible processes are skipped and missing/reused/reset baselines leave CPU unknown.

## Resource history

Monitor aligns CPU/cores, memory/cache/swap and network/disk I/O without repeated page/machine headings or a Details disclosure. Every range has 60 equal-width slots and clock-aligned ticks; CPU and memory share percentage axes, and traffic directions mirror around zero. Unrecorded slots stay blank. RAM and swap have distinct proportional capacity tracks; empty space is an unfilled track, not a separate free-space segment or legend. Storage shows aggregate capacity and used space only. Blue identifies dev, purple desktop, in device icons and measurements.

The native agent measures every 30 seconds independently of browsers, retaining only the latest real sample per minute for one hour, per quarter-hour for one day and per hour for one week: fewer than 400 records per worker, not 20,000 raw samples. Hourly Effect KeyValueStore files compact as records age; existing recordings compact on the next collection. No database/monitoring daemon dependency. Browser, worker and MCP responses have at most 60 points for every range: one-minute / 24-minute / 168-minute buckets for 1h / 24h / 7d. Only the latest point carries core/mount detail. Samples preserve their earliest represented recording time without invented timestamps or averages. CPU/rates are absent on startup, reset or a sampling gap above 90 seconds; offline workers retain last-known data marked stale.

HTTP MCP `resource_history` sends current per-core/mount detail once and aligned numeric history columns, with `intervalSeconds`; unknown rate slots encode as null, not zero. It does not repeat full core/mount records for every historical point.

Network totals include Linux `eth*`, `en*` and `wl*` interfaces, excluding loopback, VPN and Docker bridges to avoid double counting. Disk I/O includes whole `sd*`, `vd*`, `hd*` and NVMe disks, not partitions. Storage capacity sums disk-backed mounts. History starts when the native agent runs on that machine; installing only the control plane cannot collect a remote machine's CPU or memory.

## HTTPS exposure

- **Tailnet:** uses this worker's real Tailscale DNS name and `tailscale serve --bg`. No Funnel, node enrollment, ACL edits, resets or takeover of existing mappings. Removal refuses a mapping that changed outside Deploy.
- **Public:** explicit public-access confirmation, validated hostname, loopback-only backend and an exclusively owned Caddyfile. Caddy has a separate loopback admin listener on 20219. DNS and inbound 80/443 must already reach the worker, and no other proxy may own those listeners. Deploy does not replace running Traefik or alter host firewall/privileged-port policy automatically.
- **Ownership:** only records Deploy created can be removed. An interrupted/failed apply retains its intent so it can be inspected and removed; “configured” does not assert TLS issuance or backend reachability. Configure the backend's canonical `--url` and authentication separately.

Host adapters use the worker's existing `systemctl`, `ss`, Docker and Tailscale clients/daemons and their permissions. Missing tools, an unavailable daemon or denied access are visible per source; they do not erase other inventory.

Data and owned configuration use its data directory, `~/.deslop/deploy/` for a service; Caddy ships in its package and unpacks on the first public exposure. Removing the Deploy service retains data and existing exposures; remove owned exposures before uninstalling if they should stop too.
