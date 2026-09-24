---
name: environment
description: 'Use for facts about this host and the deslop and dual repositories: commands, services, ports, logins, CI, library clones, and scratch paths.'
---

## Host

- Debian 13, 8 CPUs, 23G RAM.
- Scratch, clones, logs, and screenshots go under `~/.deslop/<task>/`, where `<task>` is the worktree directory name; never /tmp, a 12G RAM tmpfs.
- Shared turbo cache: `~/.cache/turbo` (`TURBO_CACHE_DIR` is set for agents).
- Global tools: agent-browser (with Chrome), acli, gh (github.com, MP281X), glab (default host git.datapizza.tech), python and pip, jq, rg, sqlite3, bc, xxd.
- `vp` and `vpx` for every package-manager and package-binary command, never npm, npx, pnpm, yarn, or bunx; `bun` runs only as the runtime the preview steps name.
- Stop only process groups this thread started, with `kill -- -<pgid>`; take another free port instead of stopping another process.
- Datapizza VPN: openvpn3 config `datapizza`, needed only for git.datapizza.tech; one device at a time and a browser sign-in.

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
- CI: GitHub Actions job `build-and-deploy`.
- Production services run from `~/.deslop/deploy`: traefik, collector, portfolio, jaeger, valentine.
- Full local check: `vp run check`, then `vp run test`.

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
- bun 1.3.14 driven by `vp`, turbo.
- Services: opensandbox 8080, Postgres 55432, test Postgres 55433.
- Each worktree runs on its own ports, set in its `.env` files (`packages/app/.env` `SERVER_URL`, `packages/playground/.env`); other worktrees' dev apps and previews keep theirs.
- Local login: seeded by the `db:reset` script's `bun --filter @dual/core seed:user`; the credentials live in that script in `package.json`.
- CI: GitLab pipelines.

| Command               | Does                                               |
| --------------------- | -------------------------------------------------- |
| `vp run init`         | env files, services via docker compose, migrations |
| `vp run dev`          | app, playground, and worker through turbo          |
| `vp run check-types`  | type check                                         |
| `vp run lint`         | lint                                               |
| `vp run fmt`          | format                                             |
| `vpx oxfmt <path>...` | format the given files                             |
| `vp run test`         | tests                                              |
| `vp run verify`       | fmt, lint, check-types, test: the full local check |
| `vp run build`        | build                                              |

## Preview (how the user tests)

Dev mode over the VPS takes about 90 s and 25 MB per page, so the user tests a production preview of the branch.

- Choose free ports with `ss -ltn`.
- The user opens it with `ssh -N -L <port>:[::1]:<port> mp281x@77.237.236.132`, then http://localhost:<port>.

dual, from the worktree root:

1. Postgres, opensandbox, and migrations with `vp run init`, then the `seed:user` command from the `db:reset` script; the API on the port from `SERVER_URL` in packages/app/.env, and the worker, running.
2. `vpx turbo run build --filter=@dual/core...`, then in packages/app `NODE_ENV=production NITRO_PRESET=bun NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vite/bin/vite.js build` (as packages/app/docker/Dockerfile).
3. Web, from packages/app: `NODE_ENV=production HOST=127.0.0.1 PORT=<web> SERVER_URL=http://127.0.0.1:<api> bun .output/server/index.mjs`.
4. The build has no proxy (packages/app/docker/README.md) and the browser calls `window.location.origin` (src/server-url.ts), so a small Bun proxy on `[::1]:<port>` sends `/api*`, `/mcp`, and the OAuth `/.well-known/*` paths to the API, except `/api/docs/search` and `/api/sdk/search`, and everything else to the web port, as packages/playground/docker/Caddyfile does; only the proxy port is tunnelled.
5. Login: the local login above.

deslop: from the app directory, such as apps/portfolio, `HOST=::1 PORT=<port> vp run preview`, which builds and serves `dist/server.js`.
