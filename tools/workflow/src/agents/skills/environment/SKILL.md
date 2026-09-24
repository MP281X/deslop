---
name: environment
description: 'Use for facts about this host and the deslop and dual repositories: commands, services, ports, logins, CI, library clones, and scratch paths.'
---

## Host

- Debian 13, 8 CPUs, 23G RAM.
- `/tmp` is a RAM tmpfs; scratch goes under `~/.deslop/<task>/`.
- Shared turbo cache: `~/.cache/turbo` (`TURBO_CACHE_DIR` is set for agents).
- Global tools: agent-browser (with Chrome), acli, gh (github.com, MP281X), glab (default host git.datapizza.tech), python and pip, jq, rg, sqlite3, bc, xxd.
- Datapizza VPN: openvpn3 config `datapizza`, needed only for git.datapizza.tech; one device at a time and a browser sign-in, so an unreachable GitLab is a blocker.
- Ports taken by long-running services: 22, 25, 53, 80, 443 (traefik), 3000, 4318, 8080, 8090, 8110, 16686, 20241, and dual worktree Postgres ports 5543x, 5544x, 5546x.

## Library clones

`~/.deslop/repos/<name>`: agent-browser, codex, effect, executor, oxc, t3code, turborepo, vite-plus. Shallow at each default branch; refresh before use:

```sh
git -C <dir> fetch --depth 1 origin HEAD
git -C <dir> reset --hard FETCH_HEAD
```

## deslop

- `/home/mp281x/deslop`, GitHub `MP281X/deslop`, default branch `main`.
- pnpm 11.22 driven by `vp`.
- Workspaces: `apps/*` (portfolio), `packages/*` (ai, components, runtime), `tools/*` (create-app, create-package, workflow).
- CI: GitHub Actions job `build-and-deploy`.
- Production services run from `~/.deslop/deploy`: traefik, collector, portfolio, jaeger, valentine.

| Command        | Does                          |
| -------------- | ----------------------------- |
| `vp install`   | install dependencies          |
| `vp run check` | vp check and fallow dead-code |
| `vp run test`  | tests                         |
| `vp run fix`   | format and autofix            |
| `vp run build` | build                         |

## dual

- `/home/mp281x/dual`, `git.datapizza.tech/dual/dual`, default branch `master`, behind the VPN.
- bun 1.3.14 driven by `vp`, turbo.
- Services: opensandbox 8080, Postgres 55432, test Postgres 55433; worktree copies use other ports.
- Each worktree runs on its own ports, set in its `.env` files (`packages/app/.env` `SERVER_URL`, `packages/playground/.env`); other worktrees' dev apps and previews keep theirs.
- Local login: seeded by the `db:reset` script's `bun --filter @dual/core seed:user`; the credentials live in that script in `package.json`.
- Issues: Jira project DOS through `acli` (`docs/agents/issue-tracker.md`).
- User-visible or SDK changes update `packages/docs` in the same change.
- CI: GitLab pipelines.
- The user is new to the dual codebase: replies explain the code context they rely on, and questions stay about product behavior.

| Command              | Does                                               |
| -------------------- | -------------------------------------------------- |
| `vp run init`        | env files, services via docker compose, migrations |
| `vp run dev`         | app, playground, and worker through turbo          |
| `vp run check-types` | type check                                         |
| `vp run lint`        | lint                                               |
| `vp run fmt`         | format                                             |
| `vp run test`        | tests                                              |
| `vp run verify`      | fmt, lint, check-types, test: the full local check |
| `vp run build`       | build                                              |

## Preview (how the user tests)

Dev mode over the VPS takes about 90 s and 25 MB per page, so the user tests a production preview of the branch.

- Choose free ports with `ss -ltn`; start each process detached with `setsid nohup … &` and report its process group.
- The user opens it with `ssh -N -L <port>:[::1]:<port> mp281x@77.237.236.132`, then http://localhost:<port>.
- Stop only the process groups this thread started, with `kill -- -<pgid>`.

dual, from the worktree root:

1. Postgres, opensandbox, and migrations with `vp run init`; the API on the port from `SERVER_URL` in packages/app/.env, and the worker, running.
2. `vpx turbo run build --filter=@dual/core...`, then in packages/app `NODE_ENV=production NITRO_PRESET=bun NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vite/bin/vite.js build` (as packages/app/docker/Dockerfile).
3. Web, from packages/app: `NODE_ENV=production HOST=127.0.0.1 PORT=<web> SERVER_URL=http://127.0.0.1:<api> bun .output/server/index.mjs`.
4. The build has no proxy (packages/app/docker/README.md) and the browser calls `window.location.origin` (src/server-url.ts), so a small Bun proxy on `[::1]:<port>` sends `/api*`, `/mcp`, and the OAuth `/.well-known/*` paths to the API, except `/api/docs/search` and `/api/sdk/search`, and everything else to the web port, as packages/playground/docker/Caddyfile does; only the proxy port is tunnelled.
5. Login: the local account seeded by the `db:reset` script in package.json; read it there; report it for the user's reply, never put it in a brief, file, or commit.

deslop (not yet run): from the app directory, such as apps/portfolio, `HOST=::1 PORT=<port> vp run preview`, which builds and serves `dist/server.js`.
