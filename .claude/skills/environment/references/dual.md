# Dual

**Root commands.** Turbo owns package check caching; fixes are uncached. The test runner owns fingerprints/cache and continuation. Do not add an outer Vite+ cache around service-dependent tests. Fix the branch's files with `node_modules/.bin/oxfmt <files>` and `node_modules/.bin/oxlint --fix <files>`; the root fix is for a repository-wide fix the user asked for.

```bash
vp run --workspace-root check
vp run --workspace-root --no-cache fix
flock "$HOME/.deslop/dual-test.lock" vp run --workspace-root test
```

**VPN.** GitLab requires Datapizza VPN on the development host. Verify reachability; reconnect when it expires. Present the returned authentication URL through the question tool, then verify again.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

**Preview.** `vp run --workspace-root preview` owns the isolated path-derived Alchemy stage, ports, database/sandbox, migrations, administrator bootstrap and app/API/worker watchers. Sign in with `admin@dual.local` / `preview-password`; AI journeys still need provider connections. Two threads in one worktree share its stage.

**Exposure.** The printed .localhost URL is machine-local. Requested remote access uses Browser's Tailscale procedure with the actual app port; verify login/assets/API through the shared URL.

**Lifetime.** Ctrl-C stops processes but retains data. Once the owner is settled and data disposable, `vp run --workspace-root preview:destroy` removes only its stage; run before deleting/moving checkout or Alchemy state. Never use shared `init`/`dev` as an isolated preview.

**Components.** `vpx shadcn@latest list @shadcn --cwd packages/ui`; inspect current view/docs and installed source before adding a component.

**CI.** GitLab quality: frozen install, Effect-tsgo patch, check/test/documentation. Read `docs/ci.md` for failures and `docs/releasing.md` for releases; new pushes cancel interruptible pipelines. Verify consumed Effect versions per package/lock before crossing adapter boundaries.

**Tracing.** Dual SaaS optionally exports to PostHog, not Jaeger; inspect its Observability configuration.
