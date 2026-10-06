# Dual

**Commands.** Turbo caches package checks; fixes are never cached. The test runner owns its own cache, so add no outer Vite+ cache around service-dependent tests. Fix the branch's files with `node_modules/.bin/oxfmt <files>` and `node_modules/.bin/oxlint --fix <files>`; the root fix is only for a repository-wide fix the user asked for.

```bash
vp run --workspace-root check
vp run --workspace-root --no-cache fix
flock "$HOME/.deslop/dual-test.lock" vp run --workspace-root test
```

**VPN.** GitLab requires the Datapizza VPN. Check reachability and reconnect when it expires; show the returned sign-in URL through the question tool, then check again.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  openvpn3 session-auth
}
```

**Preview.** `vp run --workspace-root preview` creates the worktree's isolated Alchemy stage: ports, database, sandbox, migrations, administrator and app, API and worker watchers. Sign in as `admin@dual.local` with `preview-password`; AI journeys need provider connections. The printed `.localhost` URL is machine-local; remote access uses Browser's Tailscale procedure on the app port. Ctrl-C stops it and keeps the data. When its owner is settled, `vp run --workspace-root preview:destroy` removes the stage; run it before deleting the checkout. Never use the shared `init` or `dev` commands as a preview.

**Components.** `vpx shadcn@latest list @shadcn --cwd packages/ui`; inspect the docs and the installed source before adding one.

**CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check, test and documentation. Read `docs/ci.md` for failures and `docs/releasing.md` for releases; a new push cancels interruptible pipelines. Check each package's Effect version in the lockfile before crossing adapter boundaries.

**Tracing.** The SaaS app optionally exports to PostHog, not Jaeger; see its Observability configuration.
