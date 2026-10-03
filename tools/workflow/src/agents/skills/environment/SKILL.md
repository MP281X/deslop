---
name: environment
description: 'Facts and exact commands for this machine, deslop, and dual. Use before running, building, previewing, checking, or watching anything, or when locating a thread, login, port, or scratch path.'
---

# Environment

This skill describes `mp281x@dev`, the always-on machine the user develops on; the phone and MacBook are clients, not development hosts. The user's Linux devices on the tailnet reach each other over SSH by MagicDNS name, with keys and no password. A routine step with a block below runs the block as is; for an unfamiliar tool without a recipe, read its `--help` once and never guess flags. Initialize a new worktree with `vp install` before probing its project binaries; an existing initialized worktree does not need a fresh install for every investigation.

## Machine

- Debian 13, 8 CPUs, 23G RAM; `sudo` is passwordless. The firewall admits only 80 and 443 from the internet, for traefik; SSH and everything else listening is reached only through the user's tailnet, as `mp281x@dev`.
- Tools: docker with compose and buildx; agent-browser, with its Chrome under `~/.agent-browser/browsers/`; gh (github.com, MP281X); glab (default host git.datapizza.tech); acli; tailscale (the user's tailnet); ffmpeg; python and pip; sqlite3; jq; rg; flock; ss. `~/.vite-plus/bin` holds node and shims for every package manager: run packages with `vp` and binaries with `vpx`, never npm, npx, pnpm, yarn, or bunx; `bun` runs only where a step below names it.
- Scratch and logs go in each agent's own subfolder of the thread's `node_modules/.cache/deslop/`, ignored by git and normal repository checks; embedded screenshots and videos go in `proof/`. Reuse initialized dependencies. Delete only what you created when its question is settled; keep embedded media. Extra checkouts live in `~/.deslop/<worktree directory name>/<name>/`, outside `node_modules`.
- Search with `rg` and always an explicit path: without one it reads stdin and hangs.
- A service a task needs runs in a container the thread stops afterwards; nothing is installed on the machine. A container publishes its ports on `127.0.0.1`, since Docker's published ports bypass the firewall.
- `~/.claude` and `~/.codex` are installed from `tools/workflow/src/agents` in deslop with `node tools/workflow/src/install.ts`; change the source and reinstall, never the homes.

Find a t3 thread's transcript (Claude session or Codex rollout) from its id:

```bash
S=$(sqlite3 ~/.t3/userdata/state.sqlite "select coalesce(json_extract(resume_cursor_json,'$.resume'), json_extract(resume_cursor_json,'$.threadId')) from provider_session_runtime where thread_id = '<thread id>'")
ls ~/.claude/projects/*/$S.jsonl ~/.codex/sessions/*/*/*/*$S.jsonl 2>/dev/null
```

A Claude session's agents are in `<session>/subagents/` beside it. Codex children also live under `~/.codex/sessions/YYYY/MM/DD/`; their first `session_meta` record's `payload.parent_thread_id` links to the parent provider session, not the t3 thread id. Follow that field recursively for descendants instead of treating forked copies of the parent's messages as new work.

Stop only what you started, by its process group, never with `pkill` or `killall`; when a port is taken by something else, take another free port:

```bash
P=$(ss -ltnpH 'sport = :<port>' | grep -oP 'pid=\K[0-9]+' | head -1)
kill -- -$(ps -o pgid= -p $P | tr -d ' ')
```

Standalone probes need no extra checkout or install. Use a `.mjs` driver, or run a TypeScript driver from the target worktree root:

```bash
node --input-type=module-typescript - < node_modules/.cache/deslop/<agent>/probe.ts
```

Imports in stdin resolve from the current directory, not the driver's folder. Node cannot strip imported TypeScript under `node_modules`; repo-integrated code uses its existing app or test entrypoint.

An extra worktree is for a base check or a prototype needing incompatible source, dependency or build inputs—not merely parallel work:

```bash
W="$HOME/.deslop/$(basename "$PWD")/<name>"
git worktree add --detach "$W" origin/<default branch> && (cd "$W" && vp install)
```

Remove it as soon as its question is settled: `git worktree remove --force "$W"`.

## Native CLI calls

Run from the target worktree with a bounded task in `$brief`; both CLIs use their existing sign-in.

```bash
codex exec --ephemeral --sandbox read-only - < "$brief"
claude -p --agent review --no-session-persistence --permission-prompts none < "$brief"
```

- Skip the global workflow for one call: add `--ignore-user-config --model gpt-6.1-sol` to Codex; replace Claude's `--agent review` with `--setting-sources ''`. Authentication and project guidance remain. Use these flags, not a copied auth home or Claude's `--bare`.
- Installed roles: `~/.claude/agents/{review,Explore,general-purpose}.md` select with `--agent`; `~/.codex/agents/{review,explorer,worker}.toml` have no root `--agent` equivalent. To run a Codex role as the root, skip user config and pass its `model` with `--model`, and its `model_reasoning_effort` and `developer_instructions` with `-c key=value` (TOML-encoded values). This is a root call, not a t3 child.

Collect the owned command's completion and verify its requested result; use the harness's background execution when independent work can continue, not a detached `&` process. These calls create no resumable session. `--permission-prompts none` denies unanswered approvals; it grants no access. Claude calls remain documentation-only while its quota is reserved.

References: [Codex configuration](https://developers.openai.com/codex/config-reference), [Claude CLI](https://code.claude.com/docs/en/cli-reference).

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

The user reviews code only in t3's PR tab. On the checked 0.0.45-nightly.20261002.2561 web client, GitLab diffs load 100 files per page; Load more cannot restore files or hunks omitted by GitLab. For a large MR, compare the local merge-base diff inventory with all pages of `/projects/:id/merge_requests/:iid/diffs`, including `collapsed` and `too_large` flags. The endpoint can omit entire files even after pagination; `/raw_diffs` may contain them, but this t3 client does not use it. A successful pipeline does not establish a complete review surface. Native mobile at that tag reviews worktree diffs and opens linked PRs externally; use the web client on a phone for its PR tab. Neither inspected renderer supports Mermaid; use a rendered diagram only when it helps.

GitLab was checked at 18.10.1-ee with glab 1.117.0: ordinary chained MRs and experimental glab stacks work, but GitLab's native detected-stack UI requires 19.1. t3 web derives chains from linked layers' base/head branches in the same repository; link every layer in one thread. Keep one PR by default while the direction is changing. A review-size problem can justify a split once boundaries are stable, but every layer must be independently releasable, and squash merging requires restacking descendants. These are versioned facts, not a reason to rediscover the implementation on every task.

## Proof and previews

Visual proof is automatic for visible changes; an exposed, persistent preview is opt-in. Run temporary local proof services on `127.0.0.1`, capture meaningful states and behavior, then stop only those you own. A static result needs a screenshot, not a video replay; before/after pairs are used only when the comparison proves something.

- When the user requests a preview, bind `127.0.0.1` on a free port (`ss -ltn`), and `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>` serves it to their tailnet at `https://<host>:<port>`, where `<host>` is `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. Give that HTTPS URL, not the loopback URL, to the user. The first request waits for the certificate. A requested preview stays running with its link until the user asks to stop it; then `sudo tailscale serve --https=<port> off` and stop its process group. Existing previews from other threads are not yours to stop.
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

- Full check: `vp run check` (turbo-cached), then `flock ~/.deslop/dual-test.lock vpx turbo run test --affected --continue`; `flock ~/.deslop/dual-test.lock vp run test:workspace` runs every workspace test under the same lock. `--continue` collects all task results instead of cancelling unrelated tests at the first failure. Core and SaaS tests start their own Postgres through Testcontainers on the Docker socket. Worktrees share the host and Turbo cache; independent research and previews can continue while a full suite owns the lock.
- Format with `vpx oxfmt <path>...`; lint with `vpx oxlint --format=agent <path>...` from the package directory. A dependency change also passes `vp install --frozen-lockfile`, which CI runs first.
- `effecttsgo(duplicate-package)` comes from bun.lock pinning effect rc.115 for `@dual/workspace-aws` beside rc.112; no edit clears it, so leave it.
- CI: GitLab `quality` (`.gitlab/quality.yml`) runs `check`, `test`, and `bun scripts/Documentation.ts`, beside release-policy and `saas-infrastructure-check`; pipelines are interruptible, so each push cancels the running one.
- Database inspection uses the worktree's existing container, not a host `psql` installation: `docker compose exec -T postgres psql -U dual -d dual`. Read the table name in `packages/server/src/persistence/schema/`, then inspect it with `-c '\d public.<table>'` before writing a query; generated identifiers are not evidence of database column names.
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

Proof or requested preview, from the worktree root:

1. The stack above, then the `seed:user` command from the `db:reset` script; then the API and worker from `packages/saas` (`bun --env-file .env src/dev.ts api` and `… worker`), with `BETTER_AUTH_URL`, `APP_ORIGIN`, and `SERVER_PUBLIC_URL` set to the proof or requested preview URL: better-auth trusts only the first two as origins, and the third is the public MCP and OAuth URL. Check this worktree’s `packages/saas/src/api.ts` for `DUAL_API_PORT`, default 3825. Where supported, set a free `<api>` port; older fixed-port revisions use 3825 only when free and need sequential proof, never stopping another thread’s API.
2. `vpx turbo run build --filter=@dual/saas...`, then in packages/app `NODE_ENV=production NITRO_PRESET=bun NODE_OPTIONS=--max-old-space-size=8192 node node_modules/vite/bin/vite.js build`.
3. Web, from packages/app: `NODE_ENV=production HOST=127.0.0.1 PORT=<web> SERVER_URL=http://127.0.0.1:<api> bun .output/server/index.mjs`.
4. The proof or preview port runs this proxy (`bun <scratch>/proxy.ts`), since the build has no proxy and the browser calls its own origin; for a requested HTTPS preview, `tailscale serve` sets the forwarded host and protocol:

   ```ts
   const api = 'http://127.0.0.1:<api>'
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
   agent-browser --session proof open <proof-or-preview-url>/login
   agent-browser --session proof fill 'input[type=email]' admin@dual.local
   agent-browser --session proof fill 'input[type=password]' password
   agent-browser --session proof click 'button[type=submit]'
   agent-browser --session proof state save node_modules/.cache/deslop/proof/auth.json
   ```

### Package lint migration

Whenever you change a dual package, update its `@deslop/workflow` dependency to the latest published version first, from that package directory:

```bash
vp add -D @deslop/workflow@latest
```

The pair owns the shared lockfile: batch package dependency updates, then install and validate the resolved versions together; do not upgrade unrelated dependencies.

- A substantial change relative to the package's handwritten code: remove its local rule exclusions and downgrades, including warning acceptance, file overrides and inline suppressions; fix the whole handwritten package to pass the full shared rules. Judge the change by its proportion and structural reach, not generated churn or a fixed percentage.
- A small change: new and changed code meets the full rules, even when the package weakens them. Run with the local exclusions restored to the shared severity to inventory their actual diagnostics; remove every exclusion with no remaining violation in its scope. Retain only existing exclusions still needed by untouched legacy code, never add one to accommodate new code.
- Keep legitimate generated/build-output ignores; they are not rule exclusions. Restore the shared rule's full configuration, not just its severity, and verify the resulting package check and frozen-lockfile install.
