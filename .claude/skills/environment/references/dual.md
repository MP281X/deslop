# Dual

- `/home/mp281x/dual`, `git.datapizza.tech/dual/dual`, default branch `master`; bun 1.4.2 driven by `vp`, turbo; shadcn components in `packages/ui`, a new one added from there with `vpx shadcn add <component>`. Turbo filters take package names: `@dual/core` is `packages/server`, `@dual/saas` the API and worker host.
- Application packages use Effect 4.0.0 and Vitest 5.0.3. `packages/workspace-aws` and independently installed `infra/saas` remain on Effect rc.115; Core's `effect-beta103` alias is for schema-projection migration. Do not pass Effects/Streams across the AWS facade. Read matching cloned source, not node_modules; `vendor/effect` may be uninitialized.
- Narrow iterations: from `packages/server`, `vp run test -- test/credential-vault-memory.test.ts` selects memory vault tests, but global setup still creates/migrates a database. Inspect runner setup or use a standalone driver for database-free questions. In `packages/cli`, use `test/template.test.ts` and representative `Template.record`/`Template.files` input before the host/provider matrix. In `packages/app`, Vite `dev` on a free port with `SERVER_URL` targeting this worktree's API uses the real backend through Nitro's dev proxy. These are source-checked routes, not running-service evidence. Built-output proof follows; final checks use the shared lock.
- Datapizza VPN runs on `mp281x@dev` and reaches the user's other devices through Tailscale. From any machine, this checks GitLab and reconnects there if unreachable; immediately show its auth URL as a Markdown link:

  ```bash
  v() { ssh mp281x@dev "$@"; }
  openvpn3 configs-list 2>/dev/null | grep -q datapizza && v() { "$@"; }
  v curl -sfo /dev/null --max-time 5 https://git.datapizza.tech/users/sign_in || {
    v openvpn3 session-manage --config datapizza --disconnect
    v openvpn3 session-start --config datapizza --background
    until v openvpn3 session-auth | grep 'Auth URL'; do sleep 1; done
  }
  ```

- Full check: `vp run check`, then `flock ~/.deslop/dual-test.lock vp run test` (workspace/release tests and pair packing). Affected workspace tests: `flock ~/.deslop/dual-test.lock bun scripts/ci/Test.ts --workspace --affected`; all workspace tests: `flock ~/.deslop/dual-test.lock vp run test:workspace`. The runner owns runtime fingerprints/cache and `--continue`; `--force` requests fresh execution. Add `test:consumer` for packaging/scaffold changes. Core/SaaS use Docker-socket Testcontainers Postgres; the test lock does not block research/previews.
- Format with `vpx oxfmt <path>...`; lint with `vpx oxlint --format=agent <path>...` from the package directory. A dependency change also passes `vp install --frozen-lockfile`, which CI runs first.
- The lock still mixes stable, rc.115 and beta.103 Effect. Report actual duplicate-package diagnostics; unrelated source edits cannot remove those dependency boundaries.
- CI: GitLab `quality` (`.gitlab/quality.yml`) installs frozen with lifecycle scripts disabled, patches Effect-tsgo explicitly, then runs `check:ci`, `test` and Documentation. Start CI failures at `docs/ci.md`, releases at `docs/releasing.md`; pipelines are interruptible, so each push cancels the running one.
- Inspect the existing database with `docker compose exec -T postgres psql -U dual -d dual`, not host psql. Find the table in `packages/server/src/persistence/schema/`, then `-c '\d public.<table>'` before querying; generated identifiers are not column names.

## Worktree preview

From the T3-bound worktree root, with Bun/Docker available:

```bash
vp run preview
```

The repository owns locked installs, an Alchemy stage derived from the physical Git-root path, loopback ports, PostgreSQL/OpenSandbox, dependency builds, migrations, administrator bootstrap and app/API/worker watchers. It prints `http://<stage>.localhost:<port>`; sign in with `admin@dual.local` / `preview-password`. No manual port offsets, Compose override, proxy, `.env` edits or seed are needed. Preview ignores existing app `.env` files; AI journeys still need provider connections.

Ctrl-C stops app processes, retaining containers/data for restart. Once the preview's data is disposable, `vp run preview:destroy` removes only its stage; destroy before deleting/moving the checkout or its `infra/saas/.alchemy` state. Two threads in one worktree share a stage. Normal `init`/`dev` use the shared fixed-port stack, not isolated preview.

These commands are source-checked at master `c412c7c6`; startup/login/HMR and destroy isolation have not been run here. Readiness checks `/api/health` and `/login`, not complete AI/sandbox behavior. T3 workspace binding and remote Tailscale/HTTPS access are separate; the printed `.localhost` URL is local to this machine.

Database-free narrow seams: `vp run test -- test/init-env.test.ts` from `packages/tools/utils`; `vp run test -- test/local-preview.test.ts` from independently installed `infra/saas`. Their dependency versions differ.
