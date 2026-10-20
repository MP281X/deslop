# Dual

Dual's `AGENTS.md` owns its commands, production data, app and coding standards; this is the user's access around it.

## Workers

- **Cache.** Checks, builds, tests and previews share one Turbo cache per worker, `~/dual/.turbo/cache`, across every worktree; the agent environment sets `TURBO_SCM_BASE=origin/master` for `--affected`.
- **Accounts.** Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.
- **Preview** through the T3 `preview` project script, which runs `bun run preview` in its unit. Live webhooks: funnel the API port's `/api/webhooks` per environment's Previews, with a temporary callback URL override reverted before the push.

## Jira

Project `DOS`, board 1053, on `datapizza.atlassian.net`; the user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`. On these workers Jira goes through the `dual` MCP server, in place of the `acli` that Dual's `AGENTS.md` names.

- **Picking.** When the user asks what to work on: rank only unassigned `To Do` tickets by priority (`P1` highest), size and fit with the code. Rank Epics, Tasks, Stories and Bugs, not Areas or Initiatives. After the user approves, assign each ticket to the user and move it to `Doing`; these are the only Jira writes.
- **Page.** A ticket key links to `https://datapizza.atlassian.net/browse/<key>`.
- **Assigned.** A ticket key in a request, branch or commit means work the user started: read it and quote the requirements you use.
- **Through Dual.** Every Jira read and write is one call to the `dual` MCP server's `execute` tool with the code below, with the ticket keys in place of `DOS-289`. An action not listed here is found by a research child with `tools.search({query})` and `tools.describe.tool({path})` inside `execute`. The connection is a service account: `currentUser()` and `@me` are not the user, so name the user by account ID. A slow or confusing step is a Dual defect the user wants in the final reply.

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

The same `execute` reads the user's work calendar and mail, `matteopaludgnach@datapizza.tech`, in `Europe/Rome`; it only reads them. A day's events carry their Meet link in `hangoutLink`:

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

## Tracing

For development, `packages/saas/src/Observability.ts` sends the OTLP/HTTP JSON that deslop's Scope receives, and merges `OTEL_RESOURCE_ATTRIBUTES`. Compute the startup timestamp at every launch, so a restarted service hides its previous traces. From `packages/saas`, with its development environment configured:

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://dev.tailnet-8c4c.ts.net:4318 \
bun --env-file .env src/dev.ts api
# Use the same launch environment with `src/dev.ts worker` for the worker.
```

The nonempty PostHog marker enables Dual's exporter and Scope's receiver ignores it; production PostHog configuration stays as it is.
