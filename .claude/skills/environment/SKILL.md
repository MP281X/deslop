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
- Personal native configuration lives in deslop's `.codex/` and `.claude/`; global skill sources live in `.claude/skills/`, with `.codex/skills` linked to them; `.agents/skills/` holds repository skills only; use the project `workflow` skill's Install recipe after changing them, never edit the installed homes. The public `@deslop/coding-standards` CLI installs only repository-local engineering/design/testing skills; its `--help` is the usage reference.

## Commands

Batch independent reads/tool calls; keep dependent actions, edits and waits sequential. Search with rg and an explicit path. Quote shell text as code; never repurpose HOME/CODEX_HOME or expose secrets through command substitution. PR bodies and comments go through a scratch file passed with --body-file.

Own each command's completion and exit status. In Codex, a long command starts an exec cell with exactly `// @exec: {"yield_time_ms": 1500000}`; await exec_command with that yield, then loop write_stdin at the same yield until exit_code exists. If the cell yields, wait on that cell. In Claude, collect the owned background command's terminal result, not a log footer, quiet output or command-substring search. Servers/stacks start with a short yield and get short readiness probes.

Reuse initialized dependencies and your own scratch subfolder. A standalone probe uses the existing runtime; another checkout is only for incompatible source/build inputs, not parallelism. Remove settled fixtures/drivers, keeping logs and embedded media. No remote actions from evals, copied authentication or fake tool/service behavior. A changed check input invalidates its result; no writer mutates another check's inputs.

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

## T3 orchestration

The workflow is T3-only: the composer selects the primary harness/model; shared workflow-main owns delegation routing independently of that choice. Both use their native sign-ins on this server; no subscription relay, duplicated main prompts or terminal CLI agent workflow. Native .codex/.claude configuration and .claude/skills global sources are canonical; .codex/skills links to those sources and .agents/skills holds repository skills; install their owned global copies with the project workflow skill when they change. Both bases load workflow-main for ordinary work or the brief's named procedure for bounded work, never native subagent profiles. Codex image generation is enabled; route image tasks to its design-guided specialist. Public engineering/design/testing still come from the repository-local coding-standards installer.

Orchestrator V2 [merged October 2](https://github.com/pingdotgg/t3code/pull/2829); live server 0.0.46-nightly.20261003.2623 exposes app-owned children for Codex and Claude. Its catalog supplies exact provider/model/effort/tier options. A role label only prefixes the standalone task, not a native agent profile; no parent history or per-task tool allowlist is copied. Both harnesses read minimal role/skill bases and ordinary user/project skills; T3 does not supply per-thread multi_agent overrides. On-disk false flags parse correctly, but the current shared app-server predates installation and fresh children still advertise native spawning; callable enforcement is untested. Do not restart other sessions to test it or equate catalog presence/non-use with enforcement. maxBatchThreads applies to top-level batch creation, not delegation concurrency.

Fresh delegated children have read updated installed skills and completed real tasks; use them for workflow evals instead of native agent CLI runs. This does not prove every process-level native setting reloads: the shared Codex app-server can outlive installation, and a resumed conversation retains its earlier context. Test the changed behavior, not merely a skill name or successful launch. delegate_task creates owned child storage, not an ordinary top-level conversation; do not replace it with t3_thread_launch/create_threads for experiments or prototypes. Existing-thread reads supply evidence without creating sidebar clutter; interventions need an assigned purpose. Separate top-level conversations require the user's explicit request.

Async child completion wakes the parent. Read the durable result once when it is needed; task_status on a terminal result acknowledges delivery. A finished turn with workState waiting_for_children still has delegated work; result_available is the ready task result. Keep IDs/ownership/latest evidence in the canonical Done-when state, not a second registry or watcher.

Completed-child follow-ups are not the default on this build: [PR #15004](https://github.com/pingdotgg/t3code/pull/15004) is still open, and the current finalizer can suppress their wake-up. Use a fresh bounded task with prior decisive evidence for each new assignment. task_cancel also returns early for an originally completed task even if its later child run is active; interrupt that current thread run instead. Cancelling an active original task uses its retained taskId. No scheduler/waiter job is needed for one-shot completion.

Persistent schedules inherit the creating thread's provider/model/modes; schedule_task has no target override. Fixed-time schedules use the server process's local timezone, not the phone's, and accept a structured object such as {type: 'fixed_time', timeOfDay: '09:00', weekdays: [1,2,3,4,5]}; intervals have a one-minute minimum. The server must stay up, not the client. A bound schedule can steer an active turn and retains that thread's workspace; never bind machine maintenance to a disposable feature worktree. Unbound schedules create a fresh top-level worktree conversation per run, not a child task. Choose the stable maintenance thread and the user's cadence before creation.

Scheduler succeeded means dispatch succeeded, not that maintenance passed; inspect the actual thread result. There is no one-shot schedule or guaranteed non-overlap of provider turns. Overdue intervals catch up once; fixed-time runs more than ten minutes late are skipped. Retain scheduledTaskId to inspect, edit, pause or delete; report the returned cadence and nextRunAt after creation. Do not turn an ordinary pipeline watch or child completion into a recurring schedule.

## Pull requests and pipelines

Wait for a pipeline with one blocking command, run in the background with a `timeout` of 7200000, then read only the failed jobs' logs.

GitHub:

```bash
SHA=$(git rev-parse HEAD)
ID=$(gh run list --commit "$SHA" --json databaseId -q '.[0].databaseId')
: "${ID:?No workflow run exists for this commit}"
gh run watch "$ID" --exit-status --compact
```

If no run exists, inspect the workflow trigger instead of polling an empty lookup. After a failed watch, read its failed logs with `gh run view "$ID" --log-failed`; keep the watch's failure status.

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

The user reviews code only in t3's PR tab. The [progressive large-diff fix](https://github.com/pingdotgg/t3code/pull/10822) covers local/worktree diffs, not hosted PR diffs. On the previously checked 0.0.45-nightly.20261002.2561 web client, GitLab diffs load 100 files per page; Load more cannot restore files or hunks omitted by GitLab. Current upstream still pages GitLab `/diffs`; do not assume the newer build fixes host omissions. For a large MR, compare the local merge-base diff inventory with all pages of `/projects/:id/merge_requests/:iid/diffs`, including `collapsed` and `too_large` flags. `/raw_diffs` availability and a successful pipeline do not establish a complete review surface. Native mobile at the checked tag reviews worktree diffs and opens linked PRs externally; use the web client on a phone for its PR tab. Current upstream web/desktop and native mobile render Mermaid fences as code, not diagrams; no live visual test was made. Use an image only when a diagram helps.

GitLab was checked at 18.10.1-ee with glab 1.117.0: ordinary chained MRs and experimental glab stacks work, but GitLab's native detected-stack UI requires 19.1. t3 web derives chains from linked layers' base/head branches in the same repository; link every layer in one thread. Keep one PR by default while the direction is changing. A review-size problem can justify a split once boundaries are stable, but every layer must be independently releasable, and squash merging requires restacking descendants. These are versioned facts, not a reason to rediscover the implementation on every task.

## Proof and previews

Visual proof is automatic for visible changes; an exposed, persistent preview is opt-in. Run temporary local proof services on `127.0.0.1`, capture meaningful states and behavior, then stop only those you own. A static result needs a screenshot, not a video replay; before/after pairs are used only when the comparison proves something.

- When the user requests a preview, bind `127.0.0.1` on a free port (`ss -ltn`), and `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>` serves it to their tailnet at `https://<host>:<port>`, where `<host>` is `tailscale status --json | jq -r '.Self.DNSName | rtrimstr(".")'`. Give that HTTPS URL, not the loopback URL, to the user. The first request waits for the certificate. A requested preview stays running with its link until the user asks to stop it; then `sudo tailscale serve --https=<port> off` and stop its process group. Existing previews from other threads are not yours to stop.
- Capture proof in one agent-browser session: start `record start <path.mp4> --contact-sheet` on the already-open page before the meaningful inputs, then `record stop`. Passing a URL navigates again; use it only when proving navigation. The default 30 fps records H.264 that plays on the user's phone; the contact sheet helps inspect the actual sequence. Static results use `screenshot <path.png>` only. Sign in once per preview, then `state save <scratch>/auth.json`; later sessions start with `--state <scratch>/auth.json`.

### Browser debugging

Reuse one session and known locators; refresh a compact `snapshot -i -c` when targets change, batch independent values in one `eval`, and wait for the relevant selector or `wait --fn '<condition>'` instead of blind sleeps. A distinct state can prove several criteria; do not repeat the journey for screenshots, video, and profiling. DOM assertions do not replace opening the meaningful screenshots.

For a suspected React state/rerender issue, enable the hook before page JavaScript (enabling it later relaunches the session):

```bash
agent-browser --session <name> open --enable react-devtools <url>
agent-browser --session <name> react tree
agent-browser --session <name> react renders start
# Reproduce the relevant input once, then collect its commits
agent-browser --session <name> react renders stop --json
agent-browser --session <name> react inspect <fiber-id>
```

For slow input, scrolling or main-thread work, use `profiler start` before that same input and `profiler stop <scratch>/browser-trace.json` after it; analyze its events rather than just saving the file. This is a Chrome performance profile, not an application OTLP trace. `react renders` needs the DevTools hook; detailed render timing requires a profiling build, so normal-build commit counts are not CPU timings. Use the installed version's `--help` for a needed capability, not the entire tool catalog on every task.

### Application tracing

The existing collector and Jaeger suffice for exported backend/client traces: collector HTTP `http://127.0.0.1:4318`, Jaeger `http://127.0.0.1:16686`. Collector CORS permits the production portfolio origin and loopback dev origins on any port. The browser's default collector URL is localhost on the browser machine: agents on this VPS can use it, a requested remote preview must set `VITE_OTEL_URL` to a reachable endpoint with its actual origin allowed. Do not mistake an allowed preflight for emitted spans. Deslop's Vite source host supplies the RPC/platform layers but not `ServerRuntime.layer` telemetry; client export does not prove a correlated dev-server span. Backend tracing uses the instrumented production entrypoint, or an explicitly scoped runtime instrumentation change.

```bash
curl -fsS http://127.0.0.1:16686/api/services
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration, startTime}]}'
```

Choose the affected service and a window around one actual action; inspect span hierarchy, errors and durations, correlate client/server by trace ID, and compare the same action after a claimed fix. No spans is a coverage/export question, not evidence that the operation was fast. Logs currently go to collector debug output (`docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector`), not a queryable log store; there is no metrics pipeline. Dual's SaaS optionally exports logs/traces to PostHog, not this Jaeger; check its worktree's Observability configuration. Add no storage/dashboard containers unless the question needs them.

## deslop

- `/home/mp281x/deslop`, GitHub `MP281X/deslop`, default branch `main`; workspaces `apps/*` (portfolio), `packages/*` (ai, components, runtime), `tools/coding-standards` and `tools/create-*`; personal native configuration and skills are outside workspace packages; shadcn components in `packages/components`, a new one added with `vp run shadcn add <component>`.
- Full check: `vp run check`, then `vp run test`. Format and lint changed files in one call, since lint has no cache: `vp check --fix <path>...`; `vp lint --format=agent <path>...` prints one line per diagnostic.
- CI: GitHub Actions job `build-and-deploy`. Production runs `tools/compose.yaml` as compose project `deslop`: traefik, portfolio, jaeger (UI and API at http://127.0.0.1:16686), collector (OTLP at https://otel.mp281x.xyz and 127.0.0.1:4318).
- Preview, from the app directory: `HOST=127.0.0.1 PORT=<port> vp run preview`.

### Fast iterations

Use initialized source exports and the existing app/test seam; no production build between unsettled trials.

```bash
# Pure Effect/AI transformation, from the root: no provider or service startup
vp test packages/ai/src/lib/utils.test.ts
# Generator replacement behavior, before creating full app/package outputs
vp test tools/create-package/src/replace-directory.test.ts
# Real React + RPC source host, from apps/portfolio on a free port
HOST=127.0.0.1 vp dev --host 127.0.0.1 --port <port> --strictPort
```

The shared Vite server reloads backend source too; verify the affected RPC, not only the rendered page. Template files are outside normal lint/type/test inputs: prove generated output on a representative input, then generate the complete required outputs once settled. Use the production preview command when built output is the question, and final repository checks on stable code.

## dual

- `/home/mp281x/dual`, `git.datapizza.tech/dual/dual`, default branch `master`; bun 1.4.2 driven by `vp`, turbo; shadcn components in `packages/ui`, a new one added from there with `vpx shadcn add <component>`. Turbo filters take package names: `@dual/core` is `packages/server`, `@dual/saas` the API and worker host.
- Narrow iterations use package scripts instead of the Turbo workspace sweep: from `packages/server`, `vp run test -- test/credential-vault-memory.test.ts` selects the in-memory vault tests, but the package's global setup still creates and migrates a database. Do not infer container-free execution from a test's memory Layer; inspect runner setup or use a standalone source driver when the question needs no database. From `packages/cli`, target `test/template.test.ts` and a representative `Template.record`/`Template.files` input before the host/provider matrix. For app composition, use the Vite `dev` script in `packages/app` with a free port and `SERVER_URL` pointing to the worktree's API; its development Nitro proxy serves the real backend. These routes are source-checked, not a claim that this worktree's services are running. Built-output questions use the production proof below; final workspace checks still use the shared lock.
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

## Repository skills and incremental refactors

Engineering/design/testing are repository skills from @deslop/coding-standards, not part of the personal global workflow. From any directory inside an initialized Git repo, run the installed executable; it finds the root and replaces only those three names in .agents/skills and .claude/skills. Help is read-only; unrelated skills remain. Read engineering before code, testing before test work and design before rendered output. Rerun after upgrading the preset.

```bash
vpx deslop-coding-standards --help
vpx deslop-coding-standards
```

In consumer monorepos such as dual, upgrade the preset only in each package you actually touch, from that package directory; do not sweep untouched packages or unrelated dependencies. Deslop uses its workspace source instead of a registry upgrade. If the skills are missing, install the consumer preset first, then run its CLI:

```bash
vp add -D @deslop/coding-standards@latest
```

The pair owns the shared lockfile: batch touched-package dependency updates, install and validate the resolved versions together, then refresh the repository skills once. Do not make each worker upgrade/install the shared tree.

- A substantial change relative to the package's handwritten code: remove its local rule exclusions and downgrades, including warning acceptance, file overrides and inline suppressions; fix the whole handwritten package to pass the full shared rules. Judge the change by its proportion and structural reach, not generated churn or a fixed percentage.
- A small change: new and changed code meets the full rules, even when the package weakens them. Run with the local exclusions restored to the shared severity to inventory their actual diagnostics; remove every exclusion with no remaining violation in its scope. Retain only existing exclusions still needed by untouched legacy code, never add one to accommodate new code.
- Keep legitimate generated/build-output ignores; they are not rule exclusions. Restore the shared rule's full configuration, not just its severity, and verify the resulting package check and frozen-lockfile install.

Keep CODING_STANDARDS.md for repository/domain decisions, concrete layout and tooling ownership only. After reading the reusable skills, remove duplicated reusable coding/testing/visual rules there; retain stricter repository-specific choices and actual domain contracts. Fix contradictions at their source rather than layering another exception. This cleanup belongs to the repository being changed, not other repositories on the machine.
