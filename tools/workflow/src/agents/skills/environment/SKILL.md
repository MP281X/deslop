---
name: environment
description: 'Use for facts about this host and the deslop and dual repositories: commands, services, ports, logins, CI, library clones, and scratch paths.'
---

## Host

- Debian 13, 8 CPUs, 23G RAM.
- Agents and the user reach it only by its DNS name, as `mp281x@dev.mp281x.xyz`, never by IP.
- Scratch, clones, logs, and screenshots go under `~/.deslop/<task>/`, where `<task>` is the worktree directory name; never /tmp.
- Shared turbo cache: `~/.cache/turbo` (`TURBO_CACHE_DIR` is set for agents).
- Dedicated tools first: `rg` to search text, `jq` to process JSON, `node` to run JavaScript.
- Other global tools: agent-browser (with Chrome), acli, gh (github.com, MP281X), glab (default host git.datapizza.tech), python and pip, sqlite3, bc, xxd.
- `vp` and `vpx` for every package-manager and package-binary command, never npm, npx, pnpm, yarn, or bunx; `bun` runs only as the runtime the preview steps name.
- Stop only process groups this thread started, with `kill -- -<pgid>`; take another free port instead of stopping another process.
- Datapizza VPN: openvpn3 config `datapizza`, needed only for git.datapizza.tech; one device at a time and a browser sign-in.
- A thread id the user gives is a t3 thread id. Its Claude session is the `session_id` in `~/.t3/userdata/logs/provider/events.<id>.log*`, with the transcript at `~/.claude/projects/<cwd-slug>/<session>.jsonl` and its agents under `<session>/subagents/`, where `<cwd-slug>` is the thread's `cwd` with `/` and `.` as `-`; a Codex thread's log names its rollout as `path`, under `~/.codex/sessions/`.

## Library clones

`~/.deslop/repos/<name>`: agent-browser, base-ui, codex, effect, executor, oxc, pi (`https://github.com/earendil-works/pi.git`), t3code, turborepo, vite-plus. Library source comes only from `~/.deslop/repos`. A library without a clone is first cloned with `git clone --depth 1 --single-branch <url> ~/.deslop/repos/<name>`. Never read `node_modules` or `vendor/`. Shallow at each default branch; refresh before use:

```sh
git -C <dir> fetch --depth 1 origin HEAD
git -C <dir> reset --hard FETCH_HEAD
```

## deslop

- `/home/mp281x/deslop`, GitHub `MP281X/deslop`, default branch `main`.
- pnpm 11.22 driven by `vp`.
- Workspaces: `apps/*` (portfolio), `packages/*` (ai, components, runtime), `tools/*` (create-app, create-package, workflow).
- shadcn UI components: `packages/components`.
- CI: GitHub Actions job `build-and-deploy`.
- Production services run from `~/.deslop/deploy`: traefik, collector, portfolio, jaeger, valentine.
- Full local check: `vp run fix`, `vp run check`, then `vp run test`.

| Command            | Does                          |
| ------------------ | ----------------------------- |
| `vp install`       | install dependencies          |
| `vp run check`     | vp check and fallow dead-code |
| `vp run test`      | tests                         |
| `vp run fix`       | format and autofix            |
| `vp fmt <path>...` | format the given files        |
| `vp run build`     | build                         |

## dual

- `/home/mp281x/dual`, `git.datapizza.tech/dual/dual`, default branch `master`, behind the VPN.
- bun 1.4.2 driven by `vp`, turbo.
- shadcn UI components: `packages/ui`.
- Services: opensandbox 127.0.0.1:8080, Postgres 55432, test Postgres 55433.
- Each worktree runs on its own ports, set in its `.env` files: `SERVER_URL` in `packages/app/.env` (default 3825), and `DATABASE_URL`, `BETTER_AUTH_URL`, `SERVER_PUBLIC_URL`, `APP_ORIGIN`, and `DUAL_AGENT_GATEWAY_BASE_URL` in `packages/playground/.env`; the app dev server listens on 3000 from `vite dev --port 3000` in `packages/app/package.json`, so another port is a `--port` argument, not a `.env` value. Other worktrees' dev apps and previews keep theirs.
- Local login: seeded by the `seed:user` arguments in the root `package.json` `db:reset` script, which hold the credentials.
- CI: GitLab job `quality` (`.gitlab/quality.yml`).
- Full local check: `vp run check`, then `vp run test`.

| Command               | Does                                                                                                          |
| --------------------- | ------------------------------------------------------------------------------------------------------------- |
| `vp run init`         | env files, effect-tsgo patch, opensandbox build, docker compose services, migrations                          |
| `vp run dev`          | app, playground, and worker through turbo; `dev:app`, `dev:backend`, `dev:server`, and `dev:worker` run parts |
| `vp run db:reset`     | recreate the services and database, migrate, and seed the local login                                         |
| `vp run check`        | oxfmt check and each package's oxlint                                                                         |
| `vp run fix`          | format and autofix                                                                                            |
| `vpx oxfmt <path>...` | format the given files                                                                                        |
| `vp run test`         | tests                                                                                                         |
| `vp run build`        | build                                                                                                         |

## Preview (how the user tests)

A production preview of the branch is the user's preferred way to test a web app.

- Choose free ports with `ss -ltn`.
- The user opens it with `ssh -N -L <port>:[::1]:<port> mp281x@dev.mp281x.xyz`, then http://localhost:<port>.

dual, from the worktree root:

1. Postgres, opensandbox, and migrations with `vp run init`, then the `seed:user` command from the `db:reset` script; the API on the port from `SERVER_URL` in packages/app/.env, and the worker, running.
2. `vpx turbo run build --filter=@dual/core...`, then in packages/app `NODE_ENV=production NITRO_PRESET=bun NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vite/bin/vite.js build` (as packages/app/docker/Dockerfile).
3. Web, from packages/app: `NODE_ENV=production HOST=127.0.0.1 PORT=<web> SERVER_URL=http://127.0.0.1:<api> bun .output/server/index.mjs`.
4. The build has no proxy (packages/app/docker/README.md) and the browser calls `window.location.origin` (src/server-url.ts), so a small Bun proxy on `[::1]:<port>` sends `/api*`, `/mcp`, and the OAuth `/.well-known/*` paths to the API, except `/api/docs/search` and `/api/sdk/search`, and everything else to the web port, as packages/playground/docker/Caddyfile does; only the proxy port is tunnelled.
5. Login: the local login above.

deslop: from the app directory, such as apps/portfolio, `HOST=::1 PORT=<port> vp run preview`, which builds and serves `dist/server.js`.
