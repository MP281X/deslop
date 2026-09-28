---
name: environment
description: 'Host and repository facts for this machine, deslop, and dual. Use before running, building, previewing, or checking anything, or when locating a login, port, or scratch path.'
---

# Environment

Facts an agent cannot read from the repository itself; commands a package.json already shows are listed only where they carry a gotcha.

## Host

- Debian 13, 8 CPUs, 23G RAM.
- Agents and the user reach it only by its DNS name, as `mp281x@dev.mp281x.xyz`, never by IP.
- Scratch, logs, screenshots, and videos go under `node_modules/.cache/deslop/` in the thread's worktree, never /tmp: `node_modules` is ignored by git and every tool, and t3 deletes it with the worktree once the thread settles. A repository copy that must install, check, or test goes in `~/.deslop/<worktree directory name>/` instead, because Node refuses TypeScript type stripping under any `node_modules` path, and the thread removes it when its work is done.
- Proof artifacts are captured in one agent-browser `--session`: `record start <path.mp4> [url]` … `record stop` records H.264 video, which plays everywhere including iOS Safari (a `.webm` does not play on the phone), and `screenshot <path.png>` takes a screenshot. Sign in once per preview and `state save <scratch>/auth.json`; later sessions start with `--state <that path>` and skip the login.
- `gh pr create` or `gh pr edit` with `--attach '<file>#<alt text>'` uploads an artifact into the PR body; a video takes a bare `--attach '<file>'`, since alt text on a video fails the whole edit.
- When a thread's work is done, it stops the process groups it started, except the delivered preview the user tests, and removes any extra git worktree it made; its scratch goes with its worktree. Kept: the shared clones in `~/.deslop/repos` and evidence a handoff cites under `~/.deslop/measure`.
- Dedicated tools first: `rg` to search text, `jq` to process JSON, `node` to run JavaScript.
- Other global tools: agent-browser (with Chrome), acli, gh (github.com, MP281X), glab (default host git.datapizza.tech), python and pip, sqlite3, bc, xxd.
- `vp` and `vpx` for every package-manager and package-binary command, never npm, npx, pnpm, yarn, or bunx; `bun` runs only as the runtime the preview steps name.
- Stop only process groups this thread started, with `kill -- -<pgid>`; take another free port instead of stopping another process. The one exception is a stale preview: a listener on 4000–4009 whose `/proc/<pid>/cwd` ends in `(deleted)` belongs to a removed worktree and may be stopped to free its port.
- Datapizza VPN: openvpn3 config `datapizza`, needed only for git.datapizza.tech; one device at a time. Connect with `openvpn3 session-start --config datapizza --background` and show the printed sign-in URL as a clickable Markdown link in a normal message, outside the question tool; when `openvpn3 sessions-list` shows an expired link or failed authentication, restart at once with `openvpn3 session-manage --config datapizza --restart`, without diagnosing.
- `sudo` is passwordless. ufw allows 22, 80, and 443 publicly, and 4000–4009 only from the `deslop` Docker network for traefik's preview routes; [maintenance](references/maintain.md) keeps that rule on the network's current subnet.
- Wait for a pipeline with one blocking command: `gh run watch <id> --exit-status --compact` on GitHub, with the id from `gh run list --commit <sha>` once the run appears (`gh pr checks --watch` right after a push reports no checks), `glab ci status --wait --compact` on GitLab; then read only the failed jobs' logs.
- `~/.claude` and `~/.codex` are installed from `tools/workflow/src/agents` in deslop with `node tools/workflow/src/install.ts`; change the source and reinstall, never the homes.
- A thread id the user gives is a t3 thread id. Its Claude session is the `session_id` in `~/.t3/userdata/logs/provider/events.<id>.log*`, with the transcript at `~/.claude/projects/<cwd-slug>/<session>.jsonl` and its agents under `<session>/subagents/`, where `<cwd-slug>` is the thread's `cwd` with `/` and `.` as `-`; a Codex thread's log names its rollout as `path`, under `~/.codex/sessions/`.

## deslop

- `/home/mp281x/deslop`, GitHub `MP281X/deslop`, default branch `main`.
- pnpm 11.22 driven by `vp`.
- Workspaces: `apps/*` (portfolio), `packages/*` (ai, components, runtime), `tools/*` (create-app, create-package, workflow).
- shadcn UI components: `packages/components`.
- CI: GitHub Actions job `build-and-deploy`.
- Production services are `tools/compose.yaml`, compose project `deslop`, with certificates in `~/.deslop/deploy/acme`: traefik, portfolio, jaeger, collector. Jaeger's UI and API are only at http://127.0.0.1:16686; OTLP ingest is public at https://otel.mp281x.xyz and local at 127.0.0.1:4318. [references/setup.md](references/setup.md) bootstraps this host; [references/maintain.md](references/maintain.md) updates, redeploys, and cleans it.
- Full local check: `vp run check`, then `vp run test`; `vp fmt <path>...` formats the touched files first.
- Each lint call costs a flat 5–6 s for 1 file or a whole package, with no cache between calls, so format and lint every changed file in one call: `vp check --fix <path>...`.

| Command                            | Does                                          |
| ---------------------------------- | --------------------------------------------- |
| `vp install`                       | install dependencies                          |
| `vp run check`                     | vp check and fallow dead-code                 |
| `vp run test`                      | tests                                         |
| `vp run fix`                       | format and autofix                            |
| `vp fmt <path>...`                 | format the given files                        |
| `vp lint --format=agent <path>...` | lint the given files, one line per diagnostic |
| `vp run build`                     | build                                         |

## dual

- `/home/mp281x/dual`, `git.datapizza.tech/dual/dual`, default branch `master`, behind the VPN.
- bun 1.4.2 driven by `vp`, turbo.
- shadcn UI components: `packages/ui`.
- Services: docker-compose.yml fixes Postgres 55432, test Postgres 55433, opensandbox 127.0.0.1:8080, and the `dual-opensandbox-runtime` network, so each worktree runs its own compose project with an override in `~/.deslop/<worktree directory name>/`: `!override` moves the three ports by a multiple of 10 that no stack in `docker ps` uses, names the network `dual-opensandbox-runtime-<worktree id>`, and mounts a copy of packages/playground/docker/opensandbox.toml whose `network_mode` names it; the worktree's `.env` files use the same ports. [Maintenance](references/maintain.md) removes compose projects, previews, and `~/.deslop` copies whose worktree no longer exists.
- Each worktree runs on its own ports, set in its `.env` files: `SERVER_URL` in `packages/app/.env` (default 3825), and `DATABASE_URL`, `BETTER_AUTH_URL`, `SERVER_PUBLIC_URL`, `APP_ORIGIN`, and `DUAL_AGENT_GATEWAY_BASE_URL` in `packages/playground/.env`; the app dev server listens on 3000 from `vite dev --port 3000` in `packages/app/package.json`, so another port is a `--port` argument, not a `.env` value. Other worktrees' dev apps and previews keep theirs.
- Local login: seeded by the `seed:user` arguments in the root `package.json` `db:reset` script, which hold the credentials.
- CI: GitLab job `quality` (`.gitlab/quality.yml`), median 17 min, beside release-policy, the playground builds, build-web-image, and release-pair; pipeline median 24 min, p90 60 min. `quality` after `check` it runs `test:consumer` (about 6 min), `test`, and `test:release` in series. Pipelines are interruptible, so each push cancels the running one. A dependency change also needs `vp install --frozen-lockfile` to pass locally, which CI runs first.
- `effecttsgo(duplicate-package)` comes from bun.lock pinning effect 4.0.0-rc.115 for `@dual/workspace-aws` beside rc.112; no edit to the reported file clears it, so leave it.
- Full local check: `vp run check` (turbo-cached, about 2 s on an unchanged tree, 141 s cold), then `vpx turbo run test --affected`; turbo.json sets `cache: false` on `test`, so every run costs its full time. Run a full suite under `flock ~/.deslop/dual-test.lock` so parallel threads do not overload the host; a timeout while the load average is above 8 is load, so rerun that file alone.

| Command                               | Does                                                                                                          |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `vp run init`                         | env files, effect-tsgo patch, opensandbox build, docker compose services, migrations                          |
| `vp run dev`                          | app, playground, and worker through turbo; `dev:app`, `dev:backend`, `dev:server`, and `dev:worker` run parts |
| `vp run db:reset`                     | recreate the services and database, migrate, and seed the local login                                         |
| `vp run check`                        | oxfmt check and each package's oxlint                                                                         |
| `vp run fix`                          | format and autofix                                                                                            |
| `vpx oxfmt <path>...`                 | format the given files                                                                                        |
| `vpx oxlint --format=agent <path>...` | from the package directory, lint the given files, one line per diagnostic                                     |
| `vp run test`                         | tests                                                                                                         |
| `vp run build`                        | build                                                                                                         |

## Preview (how the user tests)

A production preview of the branch is the user's preferred way to test a web app.

- Previews use only ports 4000–4009, the range traefik routes and ufw admits: choose a free one with `ss -ltn` and bind it on `::`. Traefik serves it at `https://p<port>.mp281x.xyz`, the only URL to give the user and the browser agent; a preview bound to `::1` or `127.0.0.1`, or on another port, is unreachable there.
- The delivered preview stays running, with its link in the final message, so the user can test it.
- The `p4000`–`p4009` names are public through certificate transparency and scanners probe them within minutes, so a preview relies on the app's own login.
- A routed port with nothing listening returns 502. `vp run` starts the server in its own process group, so stop a preview by the group of the pid `ss -ltnp` shows on its port.

dual, from the worktree root:

1. Postgres, opensandbox, and migrations with `vp run init`, then the `seed:user` command from the `db:reset` script; the API on the port from `SERVER_URL` in packages/app/.env, and the worker, running. Start the API with `BETTER_AUTH_URL`, `APP_ORIGIN`, and `SERVER_PUBLIC_URL` set to `https://p<port>.mp281x.xyz`: better-auth trusts only the first two as origins, and the third is the public MCP and OAuth URL (packages/server/src/auth/BetterAuth.ts).
2. `vpx turbo run build --filter=@dual/core...`, then in packages/app `NODE_ENV=production NITRO_PRESET=bun NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vite/bin/vite.js build` (as packages/app/docker/Dockerfile).
3. Web, from packages/app: `NODE_ENV=production HOST=127.0.0.1 PORT=<web> SERVER_URL=http://127.0.0.1:<api> bun .output/server/index.mjs`.
4. The build has no proxy (packages/app/docker/README.md) and the browser calls `window.location.origin` (src/server-url.ts), so a small Bun proxy on `[::]:<port>` sends `/api*`, `/mcp`, and the OAuth `/.well-known/*` paths to the API, except `/api/docs/search` and `/api/sdk/search`, and everything else to the web port, as packages/playground/docker/Caddyfile does; only the proxy port is public.
5. Login: the local login above.

deslop: from the app directory, such as apps/portfolio, `HOST=:: PORT=<port> vp run preview`, which builds and serves `dist/server.js`.
