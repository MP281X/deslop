---
name: environment
description: 'Facts and exact commands for this machine, deslop, and dual. Use before running, building, previewing, checking, or watching anything, or when locating a thread, login, port, or scratch path.'
---

# Environment

This skill describes `mp281x@dev`, the machine the user works on; the user's Linux devices on the tailnet reach each other over SSH by MagicDNS name, with keys and no password. A routine step with a block below runs the block as is; for any other tool, read its `--help` once before the first try and never guess flags.

## Machine

- Debian 13, 8 CPUs, 23G RAM; `sudo` is passwordless. The firewall admits only 80 and 443 from the internet, for traefik; SSH and everything else listening is reached only through the user's tailnet, as `mp281x@dev`.
- Tools: docker with compose and buildx; agent-browser, with its Chrome under `~/.agent-browser/browsers/`; gh (github.com, MP281X); glab (default host git.datapizza.tech); acli; tailscale (the user's tailnet); ffmpeg; python and pip; sqlite3; jq; rg; flock; ss. `~/.vite-plus/bin` holds node and shims for every package manager: run packages with `vp` and binaries with `vpx`, never npm, npx, pnpm, yarn, or bunx; `bun` runs only where a step below names it.
- Scratch and logs go under the thread's worktree in `node_modules/.cache/deslop/`, which git and every tool ignore, and screenshots and videos a message embeds in its `proof/` subfolder. An extra git worktree that must install or run goes in `~/.deslop/<worktree directory name>/<name>/`, because Node refuses type stripping under `node_modules`. Each agent works in its own subfolder and deletes only what it created, as soon as its question is settled.
- Search with `rg` and always an explicit path: without one it reads stdin and hangs.
- A service a task needs runs in a container the thread stops afterwards; nothing is installed on the machine. A container publishes its ports on `127.0.0.1`, since Docker's published ports bypass the firewall.
- `~/.claude` and `~/.codex` are installed from `tools/workflow/src/agents` in deslop with `node tools/workflow/src/install.ts`; change the source and reinstall, never the homes.
- Installation does not update an already-running query. A fresh Codex thread reads the new config; an existing thread needs a new provider process and then compaction. Claude's provider uses `--system-prompt-snapshot off` in t3's Settings → Providers → Claude → Launch arguments so newly started or resumed sessions render the current pair file instead of reusing the initial snapshot. This t3 setting is separate from the workflow installer; changing provider configuration replaces the adapter and closes its existing queries, so change it between tasks. Installing pair files alone does not close queries.

Find a t3 thread's transcript (Claude session or Codex rollout) from its id:

```bash
S=$(sqlite3 ~/.t3/userdata/state.sqlite "select coalesce(json_extract(resume_cursor_json,'$.resume'), json_extract(resume_cursor_json,'$.threadId')) from provider_session_runtime where thread_id like '<thread id>%'")
ls ~/.claude/projects/*/$S.jsonl ~/.codex/sessions/*/*/*/*$S.jsonl 2>/dev/null
```

A Claude session's agents are in `<session>/subagents/` beside it. Its question-card answers are user decisions in `toolUseResult.answers`, not ordinary user-message text. Include them, deduplicated by the result's `tool_use_id`.

Queued user steering can be absent from the native transcript. Read the thread's user messages from t3's database too; a missing transcript quote is not evidence of an invented requirement:

```bash
sqlite3 -json ~/.t3/userdata/state.sqlite "select message_id, created_at, text from projection_thread_messages where thread_id like '<thread id>%' and role = 'user' order by created_at, message_id"
```

For isolated native Codex evaluations, prepare `<scratch>/eval` with a disposable no-remote repo, a fake `home/.codex` containing the source config/base/roles/skills snapshot and private auth copy, and `prompt.md`. Point the snapshot's `model_instructions_file` at its copied base. Resolve the installed launcher before changing HOME: Vite+ shims depend on the real home, and login shells need their own Node PATH.

```bash
R="$PWD/node_modules/.cache/deslop/eval"
V=/home/mp281x/.vite-plus
C="$V/packages/@openai/codex"
I=$(jq -r .installId "$C.json")
N="$V/js_runtime/node/$(jq -r .platform.node "$C.json")/bin"
printf 'export PATH="%s:/usr/bin:/bin"\n' "$N" > "$R/home/.bash_profile"
env -i HOME="$R/home" CODEX_HOME="$R/home/.codex" PATH="$N:/usr/bin:/bin" \
  GH_TOKEN=invalid GITHUB_TOKEN=invalid GLAB_TOKEN=invalid GITLAB_TOKEN=invalid \
  "$N/node" "$C/$I/lib/node_modules/@openai/codex/bin/codex.js" \
  exec --json --sandbox workspace-write -C "$R/repo" \
  -m gpt-6.1-sol -c model_reasoning_effort=high - < "$R/prompt.md"
```

Never link the fake home to real auth, forge/SSH config, or agent homes; keep evals local, with no commits, pushes, or remote writes. Remove the copied auth and disposable home/repo when the trial settles; preserve only sanitized evidence. For Claude, use its resolved executable with the same isolated home and an explicit fixture working directory.

Stop only what you started, by its process group, never with `pkill` or `killall`; when a port is taken by something else, take another free port:

```bash
P=$(ss -ltnpH 'sport = :<port>' | grep -oP 'pid=\K[0-9]+' | head -1)
kill -- -$(ps -o pgid= -p $P | tr -d ' ')
```

An extra worktree, such as the default branch for a before screenshot or a base check:

```bash
W=~/.deslop/$(basename $PWD)/<name>
git worktree add --detach $W origin/<default branch> && (cd $W && vp install)
```

Remove it as soon as its question is settled: `git worktree remove --force $W`.

## Pull requests and pipelines

Wait for a pipeline with one blocking command, run in the background with a `timeout` of 7200000, then read only the failed jobs' logs.

GitHub:

```bash
until ID=$(gh run list --commit $(git rev-parse HEAD) --json databaseId -q '.[0].databaseId') && [ -n "$ID" ]; do sleep 5; done
gh run watch $ID --exit-status --compact || gh run view $ID --log-failed
```

GitLab:

```bash
glab ci status --wait --compact
ID=$(glab api "projects/dual%2Fdual/pipelines?ref=$(git branch --show-current)&per_page=1" | jq -r '.[0].id')
glab api "projects/dual%2Fdual/pipelines/$ID/jobs?scope[]=failed" | jq -r '.[] | "\(.id) \(.name)"'
glab ci trace <job id>
```

A PR or MR body goes through a scratch file; an artifact is uploaded into the body (on GitHub, a video takes a bare `--attach '<file>'`, an image `--attach '<file>#<alt text>'`):

```bash
gh pr edit --body-file <scratch>/body.md --attach '<file>#<alt text>'
glab mr update <number> --draft --description-file <scratch>/body.md --attach <file>
```

`glab` takes no `--jq`: pipe `glab api` into `jq`.

## Proof and previews

A production preview of the branch is how the user tests a web app.

- A preview binds `127.0.0.1` on a free port (`ss -ltn`), and `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>` serves it to the user's tailnet at `https://<host>:<port>`, where `<host>` is `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`: the only URL to give the user and the browser agent. The first request waits for the certificate. A preview stays running once the user could open it, with its link in the last message, until the user asks to stop it; then `sudo tailscale serve --https=<port> off` and stop its process group.
- Capture proof in one agent-browser session: `record start <path.mp4> <url>` … `record stop` records H.264 video, which plays on the user's phone, and `screenshot <path.png>` takes a screenshot. Sign in once per preview, then `state save <scratch>/auth.json`; later sessions start with `--state <scratch>/auth.json`.

## deslop

- `/home/mp281x/deslop`, GitHub `MP281X/deslop`, default branch `main`; workspaces `apps/*` (portfolio), `packages/*` (ai, components, runtime), `tools/*` (create-app, create-package, workflow); shadcn components in `packages/components`, a new one added with `vp run shadcn add <component>`.
- Full check: `vp run check`, then `vp run test`. Format and lint changed files in one call, since lint has no cache: `vp check --fix <path>...`; `vp lint --format=agent <path>...` prints one line per diagnostic.
- CI: GitHub Actions job `build-and-deploy`. Production runs `tools/compose.yaml` as compose project `deslop`: traefik, portfolio, jaeger (UI and API at http://127.0.0.1:16686), collector (OTLP at https://otel.mp281x.xyz and 127.0.0.1:4318).
- Preview, from the app directory: `HOST=127.0.0.1 PORT=<port> vp run preview`.

## dual

- `/home/mp281x/dual`, `git.datapizza.tech/dual/dual`, default branch `master`; bun 1.4.2 driven by `vp`, turbo; shadcn components in `packages/ui`, a new one added from there with `vpx shadcn add <component>`. Turbo filters take package names: `@dual/core` is `packages/server`, `@dual/saas` the API and worker host.
- git.datapizza.tech needs the Datapizza VPN, whose session runs on `mp281x@dev` and reaches the user's other devices through Tailscale. The session can still drop: on any machine, run exactly these commands, which check GitLab from `mp281x@dev` and reconnect the session there when it is unreachable, then show the URL at once as a Markdown link in a normal message:

  ```bash
  v() { ssh mp281x@dev "$@"; }
  openvpn3 configs-list 2>/dev/null | grep -q datapizza && v() { "$@"; }
  v curl -sfo /dev/null --max-time 5 https://git.datapizza.tech/users/sign_in || {
    v openvpn3 session-manage --config datapizza --disconnect
    v openvpn3 session-start --config datapizza --background
    until v openvpn3 session-auth | grep 'Auth URL'; do sleep 1; done
  }
  ```

- Full check: `vp run check` (turbo-cached), then `vpx turbo run test --affected`; `vp run test:workspace` runs every workspace test. Core and SaaS tests start their own Postgres through Testcontainers on the Docker socket. Run a full suite under `flock ~/.deslop/dual-test.lock` so parallel threads take turns.
- Format with `vpx oxfmt <path>...`; lint with `vpx oxlint --format=agent <path>...` from the package directory. A dependency change also passes `vp install --frozen-lockfile`, which CI runs first.
- `effecttsgo(duplicate-package)` comes from bun.lock pinning effect rc.115 for `@dual/workspace-aws` beside rc.112; no edit clears it, so leave it.
- CI: GitLab `quality` (`.gitlab/quality.yml`) runs `check`, `test`, and `bun scripts/Documentation.ts`, beside release-policy and `saas-infrastructure-check`; pipelines are interruptible, so each push cancels the running one.
- Each worktree runs its own compose project, moved by an offset no other stack uses; the root `.env` holds the project for every compose call, and `packages/saas/.env` the moved ports:

  ```bash
  I=$(basename $PWD); D=~/.deslop/$I; mkdir -p $D
  for N in 10 20 30 40 50 60 70 80 90; do ss -ltn | grep -q ":$((55432 + N)) " || break; done
  sed "s/dual-opensandbox-runtime/dual-opensandbox-runtime-$I/" packages/saas/docker/opensandbox.toml > $D/opensandbox.toml
  cat > $D/compose.override.yml <<EOF
  services:
    opensandbox:
      ports: !override ["127.0.0.1:$((8080 + N)):8080"]
      volumes: !override [/var/run/docker.sock:/var/run/docker.sock, $D/opensandbox.toml:/etc/opensandbox/config.toml:ro, opensandbox-data:/root/.opensandbox]
    postgres:
      ports: !override ["127.0.0.1:$((55432 + N)):5432"]
    postgres-test:
      ports: !override ["127.0.0.1:$((55433 + N)):5432"]
  networks:
    opensandbox-runtime:
      name: dual-opensandbox-runtime-$I
  EOF
  printf 'COMPOSE_PROJECT_NAME=%s\nCOMPOSE_FILE=%s\n' $I "$PWD/docker-compose.yml:$D/compose.override.yml" >> .env
  vpx dual-utils init-env
  sed -i "s/:55432\//:$((55432 + N))\//; s/localhost:8080/localhost:$((8080 + N))/" packages/saas/.env
  vp run init
  ```

Preview, from the worktree root:

1. The stack above, then the `seed:user` command from the `db:reset` script; then the API and worker from `packages/saas` (`bun --env-file .env src/dev.ts api` and `… worker`), with `BETTER_AUTH_URL`, `APP_ORIGIN`, and `SERVER_PUBLIC_URL` set to the preview URL: better-auth trusts only the first two as origins, and the third is the public MCP and OAuth URL. The API listens on 3825, fixed in `packages/saas/src/api.ts`, so the before and after previews run one at a time: capture the before, stop it, then start the branch's.
2. `vpx turbo run build --filter=@dual/saas...`, then in packages/app `NODE_ENV=production NITRO_PRESET=bun NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vite/bin/vite.js build`.
3. Web, from packages/app: `NODE_ENV=production HOST=127.0.0.1 PORT=<web> SERVER_URL=http://127.0.0.1:3825 bun .output/server/index.mjs`.
4. The preview port runs this proxy (`bun <scratch>/proxy.ts`), since the build has no proxy and the browser calls its own origin; `tailscale serve` already sets the forwarded host and protocol:

   ```ts
   const api = 'http://127.0.0.1:3825'
   const web = 'http://127.0.0.1:<web>'
   const toApi = (path: string) =>
   	(path.startsWith('/api') && !path.startsWith('/api/docs/search') && !path.startsWith('/api/sdk/search')) ||
   	path === '/mcp' ||
   	path.startsWith('/mcp/') ||
   	path.startsWith('/.well-known/')
   Bun.serve({
   	fetch(request) {
   		const url = new URL(request.url)
   		return fetch(new URL(url.pathname + url.search, toApi(url.pathname) ? api : web), {
   			body: request.body,
   			duplex: 'half',
   			headers: request.headers,
   			method: request.method,
   			redirect: 'manual'
   		})
   	},
   	hostname: '127.0.0.1',
   	idleTimeout: 0,
   	port: <port>
   })
   ```

5. Sign in, from the worktree root, with the `seed:user` credentials:

   ```bash
   agent-browser --session proof open https://<host>:<port>/login
   agent-browser --session proof fill 'input[type=email]' admin@dual.local
   agent-browser --session proof fill 'input[type=password]' password
   agent-browser --session proof click 'button[type=submit]'
   agent-browser --session proof state save node_modules/.cache/deslop/proof/auth.json
   ```
