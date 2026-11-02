# App runtime

Shared server CLI, service lifecycle, HTTP/MCP authorization, telemetry and web/mobile RPC transports. Server packages bundle their JavaScript; Node remains the Vite+-managed runtime, not another bundled copy.

## Server CLI

Replace `scope` with the app's executable:

```bash
scope                                                 # foreground on 127.0.0.1 and the package's config.port
scope --port 5200                                     # another port
scope service install --url https://scope.example.com --auth https://auth.mp281x.xyz
scope service status
scope service update                                  # npm's latest release now, as the 15-minute timer does
scope service uninstall                               # remove the units, keep the app's data
```

A server entry is `CliRuntime.runApp({icon, routes})`: its RPC, HTTP routes and `ServerRuntime.layerMcp` tools, with its services provided. The runtime adds sign-in, the origin guard, `/icon`, the web manifest and pages, telemetry and the HTTP server, and reads the name, version and default port from the `package.json` beside the bundle.

Every flag falls back to its environment variable, and app code reads either through `Config`: `--host` `HOST`, `--port` `PORT`, `--url` `APP_URL`, `--auth` `AUTH_URL`, `--traces` `OTEL_URL`, plus each app's own, listed by `--help`. Non-secret settings are flags, so they show in the unit file; secrets stay in `~/.deslop/<app>.env`, which the unit loads.

## Sign-in

Pages and assets are public; RPC and MCP need a user. Without `--auth` every request is the trusted developer, and only loopback, IP addresses and the `--url` host are served, so a rebound DNS name cannot reach the app. With `--auth` the user comes from Auth's shared session cookie or a bearer for the app's `--url`, and any host name a proxy adds keeps working. Either way a browser's `Origin` must match the host it reached, except on Scope's OTLP receiver. A signed-out page goes straight to Auth through `/auth/sign-in`; the app bar's account menu signs out through `/auth/sign-out`.

MCP is HTTP-only at the app's `/mcp`, advertising [RFC 9728 resource metadata](https://www.rfc-editor.org/rfc/rfc9728.html) when Auth is on; the MCP client owns its OAuth sign-in.

## Services and data

`service install` writes a user systemd unit that runs the package `~/.deslop/<app>/current` links to, and an update timer. Every 15 minutes it compares npm's latest release with the running one; on a newer one it installs it beside the current, switches the link and restarts the unit, so two versions never run at once, then deletes releases older than the previous. There is no rollback: Verify gates releases, and data changes cannot be undone. Enable user lingering on a worker that must keep services after logout.

An installed app keeps its data in `~/.deslop/<app>`; one run from a checkout, such as a preview, in the checkout's `.deslop/<app>`.

## Native tools

An app's native executables ship zstd-compressed in its `bin/` with their licenses; `ServerRuntime.tool` unpacks one into the data directory on first use and again only for a new release. Updates follow RELEASING.md's **Native tools**. They are Linux x64 executables and rely on the host's normal glibc baseline.
