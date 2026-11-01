# App runtime

Shared server CLI, service lifecycle, HTTP/MCP authorization, telemetry and web/mobile RPC transports. Server packages bundle their JavaScript; Node remains the Vite+-managed runtime, not another bundled copy.

## Server CLI

Replace `scope` with the app's executable:

```bash
scope                                      # foreground, 127.0.0.1:5000
scope --port 5100                           # a second app needs a distinct port
scope service install --port 5100           # user systemd service
scope service status
scope service update                        # update its managed service from npm
scope service uninstall                     # remove the unit, retain app data
scope mcp                                  # stdio attachment to the running HTTP MCP
```

`--host`, `--port`, `--url`, `--auth` and `--traces` override their environment equivalents (`HOST`, `PORT`, `APP_URL`, `AUTH_URL`, `VITE_OTEL_URL`). `--url` is the canonical HTTP(S) origin, including a nonstandard port. Set it to the HTTPS hostname before proxying an app: unknown Host headers and cross-origin unauthenticated requests are rejected. Non-loopback unauthenticated serving requires explicit `--public`; a proxy is not authentication.

No issuer or telemetry endpoint is required locally. `--traces <OTLP/HTTP endpoint>` enables server and web-client export at runtime; mobile exporters keep their own app configuration. Containers can use `SERVER_OTEL_URL` for a private server-to-Scope endpoint while the browser uses the public `VITE_OTEL_URL`.

Services keep immutable code under `~/.deslop/<app>/releases/` and an atomic `current` link. Unit files are under `~/.config/systemd/user/`; optional `~/.deslop/<app>.env` supplies app-specific environment/secrets. Service settings and CLI credentials stay under the app's data directory. Installing again restarts the unit with the new settings. Enable user lingering on the worker if it must survive logout. Containers run the same npm artifact in the foreground, never systemd.

## Optional Auth

```bash
scope --auth https://auth.mp281x.xyz --url https://scope.example.com
scope login --auth https://auth.mp281x.xyz --url https://scope.example.com
scope mcp --auth https://auth.mp281x.xyz --url https://scope.example.com
```

The server first requests protected-resource enrollment. A signed-in admin approves or denies the exact resource origin in Auth → Resources. A pending/denied resource cannot receive usable OAuth grants. Disabling it rejects existing tokens too. Previously deployed Deslop resource identifiers remain approved until explicitly disabled. Pending requests expire after ten minutes; the bounded inbox evicts its oldest pending request when full. Approvals and admin denials are durable and do not consume pending capacity; denying a request clears that pending slot without permitting re-enrollment to bypass the decision.

Enrollment is a **Deslop issuer-specific provisioning extension**, not OAuth client registration or a device grant: neither RFC 7591 nor RFC 8628 registers a protected resource. HTTP MCP advertises [RFC 9728 resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html); client registration uses [RFC 7591](https://www.rfc-editor.org/rfc/rfc7591.html), and CLI sign-in uses authorization code + S256 PKCE, state and issuer checks, then refresh-token rotation. `--auth` currently expects the Deslop issuer's verification/session API, not an arbitrary OIDC provider; browser sign-in retains Deslop's shared-domain cookie model. Local installs need none of this infrastructure.

`login` prints a URL and listens on an ephemeral loopback callback ([RFC 8252](https://www.rfc-editor.org/rfc/rfc8252.html)). Open it on the CLI's machine, or forward that callback port over SSH for a headless worker. Credentials are mode 0600, separated by issuer and resource origin. Logging in to a remote worker never changes the installed service's settings or updater probe target; repeat its URL/Auth flags when attaching directly. Refreshes are serialized across CLI processes; after an interrupted/crashed refresh, the error names the lock to remove only once no owner is running. Never pass bearer/refresh tokens as command-line flags.

`mcp` forwards tools, concrete resources and prompts to the persistent service. It does not open the app's data, start a second server, or turn protocol logs into stdout. An unavailable service is an error, not a fallback process. Resource templates, subscriptions and remote list-change notifications are not bridged yet. Use HTTP MCP directly for those capabilities.

## Deploy updates

`deploy service install` also enables a separate user systemd timer. Every 15 minutes, with jitter, its oneshot checks npm's latest linear `0.1.<release>` version, stages an exact install with lifecycle scripts disabled, validates the CLI, atomically switches `current`, restarts Deploy and probes the expected runtime version. A failed restart/probe restores the previous code. Downtime is intentional. Other apps update only through their own `service update` command or a new installation; Deploy does not deploy their application code.

The updater is separate from the process it restarts; it does not overwrite a running bundle or a Vite+/npm global install. A rejected release is quarantined in `failed-version` rather than retried every 15 minutes; a newer release can proceed. Successful activation keeps only current and immediately previous code releases. Node/npm, registry access and a working user systemd manager are prerequisites. A machine power loss during activation may require restoring the saved `previous` link manually; application data is not rolled back. A stale lifecycle lock is never stolen automatically.

## Packaging

Builds emit `release/`: the server bundle, client assets where present, native tools where needed and dependency-free npm metadata. Pack **that directory**, not an Expo/workspace manifest. The exact tarball is both published to npm and unpacked by its Docker image. Release workflow bootstrap and publication approvals live in [RELEASING.md](https://github.com/MP281X/deslop/blob/main/RELEASING.md).

Linux x64 packages currently match the two workers. Stash bundles checksum-pinned FFmpeg/ffprobe and a yt-dlp PyInstaller executable (Python included); Deploy bundles checksum-pinned Caddy. These are executables, not WASM, and still rely on the host's normal Linux/glibc, libgcc and zlib baseline. Release preparation uses `tar`; runtime media processing does not require apt, pip or a separately installed Python/FFmpeg/Caddy. Native licenses and source references travel in `bin/`.
