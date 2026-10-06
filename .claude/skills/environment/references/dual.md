# Dual

**Commands.** Turbo caches package checks; fixes are never cached. The test runner owns its fingerprints, cache and continuation, so add no outer Vite+ cache around service-dependent tests. Fix the branch's files with `node_modules/.bin/oxfmt <files>` and `node_modules/.bin/oxlint --fix <files>`; the root fix is only for a repository-wide fix the user asked for.

```bash
vp run --workspace-root check
vp run --workspace-root --no-cache fix
flock "$HOME/.deslop/dual-test.lock" vp run --workspace-root test
```

**VPN.** GitLab requires the Datapizza VPN. Check reachability and reconnect when it expires. Show the returned sign-in URL as a full URL under **Needs you**, directly after the result, then check again.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

**Preview.** `vp run --workspace-root preview` creates an isolated Alchemy stage derived from the checkout path. The stage holds the ports, database, sandbox, migrations, administrator and the app, API and worker watchers. Two threads in one worktree share its stage.

- **Sign-in.** Sign in as `admin@dual.local` with `preview-password`. AI journeys need provider connections.
- **Exposure.** The printed `.localhost` URL is machine-local. Remote access uses Browser's Tailscale procedure on the app port; verify sign-in, assets and API calls through the shared URL.
- **Lifetime.** Ctrl-C stops the preview and keeps its data. When every owner is settled and the data is disposable, `vp run --workspace-root preview:destroy` removes only that stage. Run it before you move or delete the checkout or its Alchemy state.
- **Never.** Never use the shared `init` or `dev` commands as a preview.

**Components.** `vpx shadcn@latest list @shadcn --cwd packages/ui`; inspect the docs and the installed source before adding one.

**CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check, test and documentation. Read `docs/ci.md` for failures and `docs/releasing.md` for releases; a new push cancels interruptible pipelines. Check each package's Effect version in the lockfile before crossing adapter boundaries.

**Tracing.** The SaaS app optionally exports to PostHog, not Jaeger; see its Observability configuration.
