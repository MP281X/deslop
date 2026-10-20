# Dual

Dual is a production SaaS in startup mode: requirements change often and anything can change, except that production data must keep working.

## Production data

- **Migrate, never reset.** Every change to a persisted shape ships a migration that converts existing rows: a renamed id, a stored enum value, a JSON column shape, a table. A schema change comes from `bun run db:generate` in `packages/server`; a data change is `bun run db:generate --custom --name <name>` filled with SQL that rewrites existing rows in place and skips rows already converted.
- **Prove it** on a local database seeded with the old shape: run the migration, then the changed journey. The user has no production database access; never make one a merge prerequisite.
- The new code reads only the new shape: no alias or dual read path.

## Commands

From the root. Checks, builds, tests and previews share one Turbo cache per worker, `~/dual/.turbo/cache`, across all its worktrees.

```bash
bun run fix && bun run check --affected && bun run test --affected   # fix (lint fixes, then format, branch files only), check, test
```

- **`--affected`** keeps the root tasks (format, scripts, infra, `test:release`) and runs only changed packages and their dependents against `TURBO_SCM_BASE`, which the agent environment sets to `origin/master`: about 40 package tasks for a typical branch instead of 276, and Turbo replays unchanged ones from cache. Never run them without `--affected` locally: each package runs a type-aware linter at 4–7 GB, a full run takes up to 30 minutes, and the pipeline runs it.
- **Generated:** root `codegen` (icons, agent docs), `bun --filter @dual/docs generate` (Fumadocs), `dual openapi-plugin` (internal plugins and their `turbo.json`).
- **Tests** start their own database containers. Run consumer acceptance and live release tests only when their contracts change.

## Jira

Project `DOS`, board 1053, on `datapizza.atlassian.net`; the user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

- **Picking.** When the user asks what to work on: rank only unassigned `To Do` tickets by priority (`P1` highest), size and fit with the code; skip every other status. Rank Epics, Tasks, Stories and Bugs, not Areas or Initiatives. After the user approves, assign each ticket to the user and move it to `Doing`; these are the only Jira writes.
- **Page.** A ticket key links to `https://datapizza.atlassian.net/browse/<key>`.
- **Assigned.** A ticket key in a request, branch or commit means work the user started: read it and quote the requirements you use.
- **Through Dual.** Every Jira read and write is one call to the `dual` MCP server's `execute` tool with the code below, with the ticket keys in place of `DOS-289`. An action not listed here is found by a research child with `tools.search({query})` and `tools.describe.tool({path})` inside `execute`. The connection is a service account: `currentUser()` and `@me` are not the user, so name the user by account ID. Report each slow or confusing step to the user, who builds Dual.

```js
// search, every page; for the user's open tickets the jql is
// project = DOS AND assignee = "712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a" AND statusCategory != Done
const jql = 'project = DOS AND assignee is EMPTY AND status = "To Do" ORDER BY priority DESC, updated DESC'
const rows = []
let nextPageToken
do {
	const page = await tools['atlassian-api.jira-issue-search.search-and-reconsile-issues-using-jql']({
		jql,
		fields: ['issuetype', 'priority', 'status', 'summary'],
		maxResults: 100,
		nextPageToken
	})
	rows.push(
		...page.issues.map(i =>
			[i.key, i.fields.issuetype.name, i.fields.priority.name, i.fields.status.name, i.fields.summary].join(' | ')
		)
	)
	nextPageToken = page.nextPageToken
} while (nextPageToken)
return rows
```

```js
// one ticket and every comment
const issue = await tools['atlassian-api.jira-issues.get-issue']({
	issueIdOrKey: 'DOS-289',
	fields: ['summary', 'description', 'status']
})
const comments = []
let page
do {
	page = await tools['atlassian-api.jira-issue-comments.get-comments']({
		issueIdOrKey: 'DOS-289',
		startAt: comments.length,
		maxResults: 100
	})
	comments.push(...page.comments)
} while (comments.length < page.total)
return {comments, issue}
```

```js
// take a picked ticket: assign it to the user, then move it to Doing (transition 21)
await tools['atlassian-api.jira-issues.assign-issue']({
	issueIdOrKey: 'DOS-289',
	payload: {accountId: '712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a'}
})
return await tools['atlassian-api.jira-issues.do-transition']({
	issueIdOrKey: 'DOS-289',
	payload: {transition: {id: '21'}}
})
```

## Google

The same `execute` reads the user's work calendar and mail, `matteopaludgnach@datapizza.tech`, in `Europe/Rome`; nothing writes to them. A day's events carry their Meet link in `hangoutLink`:

```js
const events = await tools['google-api.calendar-events.list']({
	calendarId: 'primary',
	timeMin: '2026-10-19T00:00:00+02:00',
	timeMax: '2026-10-20T00:00:00+02:00',
	singleEvents: true,
	orderBy: 'startTime',
	timeZone: 'Europe/Rome'
})
const list = await tools['google-api.gmail-users-messages.list']({userId: 'me', maxResults: 12, q: 'in:inbox'})
const mails = []
for (const message of list.messages ?? []) {
	mails.push(
		await tools['google-api.gmail-users-messages.get']({
			userId: 'me',
			id: message.id,
			format: 'metadata',
			metadataHeaders: ['From', 'Subject', 'Date']
		})
	)
}
return {events: events.items, mails}
```

## VPN

`git.datapizza.tech` works only through dev's VPN route. When it does not answer, reconnect on dev (through `ssh mp281x@dev` from desktop), give the user the printed sign-in URL once, then check again:

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  # right after the start it prints "No sessions requires authentication interaction"
  timeout 55 bash -c 'until openvpn3 session-auth | rg -o "https://\S+"; do sleep 1; done'
}
```

## Preview

The `preview` project script runs `bun run preview` in its unit and builds an isolated Alchemy stage from the checkout path: database, sandbox, migrations, an administrator and app, API and worker watchers. It proves iteration, not a production build. Sign in as `admin@dual.local` with `preview-password`; AI journeys need provider connections.

- Source edits reload through the watchers. `stop` keeps containers and data; `bun run preview:destroy` (the settle cleanup) removes the stage. Run it before you move or delete a checkout.
- Live webhooks: funnel the API port's `/api/webhooks` per environment's Previews, with a temporary callback URL override reverted before the push.
- Never use the shared `init` or `dev` commands as a preview.
- **Accounts.** Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.

## App

- **Dual Apps.** An app complements Dual's screens for one workflow, never a form or website builder. Whoever opens a workflow opens its apps; an invitation opens one app without workflow access. Apps share the company font, sizes and primary color; layout, spacing, size and radius vary per app. An app sends a notification or email only when Dual's workflows already send it.
- **Components** come from the shadcn primitives in `packages/ui/src/components`; add a missing one with `vpx shadcn@latest add <name> --cwd packages/ui`.
- **Frontend state.** Each feature defines its own `Atom.runtime(layer)` and mounts a `RegistryProvider`.
- **CI.** The GitLab quality job runs a frozen install, the Effect-tsgo patch, then check, test and docs in one Turbo graph; see `docs/ci.md` and `docs/releasing.md`. A new push cancels interruptible pipelines.

## Tracing

The SaaS exports to PostHog. For development, `packages/saas/src/Observability.ts` sends the same OTLP/HTTP JSON that deslop's Scope receives, and merges `OTEL_RESOURCE_ATTRIBUTES`. Compute the startup timestamp at every launch, never in `.env`, so restarting a service hides its previous traces. From `packages/saas`, with its development environment and dependencies already configured:

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://dev.tailnet-8c4c.ts.net:4318 \
bun --env-file .env src/dev.ts api
# Use the same launch environment with `src/dev.ts worker` for the worker.
```

The nonempty PostHog marker enables Dual's exporter; Scope's receiver ignores it. This is opt-in development configuration, not a change to Dual's production PostHog configuration.

## Coding standards

Each package pins its own `@deslop/coding-standards`; its `oxlint.config.ts` holds a legacy file list whose rules drop to warnings.

- **Skills** refresh into `.claude/skills` and `.agents/skills` through the worktree script `vpx @deslop/coding-standards@latest`, and stay tracked: commit each refresh.
- **Bump** only when the user asks: `bun add --dev --exact @deslop/coding-standards@latest` in every package directory, the root, the scaffold baseline and consumer fixtures, then `bun run fix`. A rule the bump breaks is turned off in that package's `oxlint.config.ts`, never inline.
- **Touched files.** A hand-written file the task adds or rewrites over half of leaves the legacy list and passes every rule. Other changed files stay listed; never refactor a file only for lint.
- **Prune** after the change: remove listed files that this command no longer prints.

  ```bash
  "$(git rev-parse --show-toplevel)"/node_modules/.bin/oxlint --format json . | jq -r '[.diagnostics[].filename] | unique[]'
  ```

- **Never linted:** generated code, build output and shadcn primitives (formatted only, never refactored). Everything is type-checked.
