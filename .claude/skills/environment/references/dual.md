# Dual

Dual's `AGENTS.md` owns its commands, production data, app and coding standards; this is the user's access around it.

## Workers

- **Accounts.** Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.
- **Merge requests** are squash-merged, stacks included, and delete their source branch on merge; restack per pull-requests.
- **Preview** through the T3 `preview` project script: `bun run preview` runs the worktree's own database, sandbox, API, worker and app without `.env` files, AWS or model keys, and prints its URL and the login `admin@dual.local` / `preview-password`. Restart it after changing a published package; `settle` destroys its data. Live webhooks: funnel `/api/webhooks` to the preview port, which proxies `/api` to the API, per environment's Previews. Google OAuth needs the printed origin plus `/api/connections/auth/callback` registered.

## Jira

Project `DOS`, board 1053, on `datapizza.atlassian.net`; the user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`. On these workers Jira goes through the `dual` MCP server, in place of the `acli` that Dual's `docs/agents/issue-tracker.md` names.

- **Picking.** When the user asks what to work on: rank only unassigned `To Do` tickets by priority (`P1` highest), size and fit with the code. Rank Epics, Tasks, Stories and Bugs, not Areas or Initiatives. After the user approves, assign each ticket to the user and move it to `Doing`; these are the only Jira writes.
- **Page.** A ticket key links to `https://datapizza.atlassian.net/browse/<key>`.
- **Assigned.** A ticket key in a request, branch or commit means work the user started: read it and quote the requirements you use.
- **Through Dual.** Jira goes through the `dual` MCP server's `execute`, which finds its own tools (`atlassian-api.*`). The connection is a service account: `currentUser()` and `@me` are not the user, so name the user by account ID. `To Do` means `status = "To Do"`; `statusCategory = "To Do"` also returns Backlog. `Doing` is transition `21`. A slow or confusing step is a Dual defect the user wants in the final reply.

## Google

The same `execute` reads the user's work calendar and mail, `matteopaludgnach@datapizza.tech` (`google-api.*`, calendar `primary`), in `Europe/Rome`; it only reads them. Its sandbox has no `Intl`, so convert times by the zone's offset.

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

`packages/saas/src/Observability.ts` sends the OTLP/HTTP JSON that deslop's Scope receives, with `OTEL_RESOURCE_ATTRIBUTES` merged into its resource. The preview clears its environment, so it exports nothing; trace a development launch instead. Compute the startup timestamp at every launch, so a restarted service hides its previous traces. After `vp run build:runtime` at the root, from `packages/saas` with its development environment configured:

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://dev.tailnet-8c4c.ts.net:4318 \
bun --env-file .env src/dev.ts api
# Use the same launch environment with `src/dev.ts worker` for the worker.
```

The nonempty PostHog marker enables Dual's exporter and Scope's receiver ignores it; production PostHog configuration stays as it is.
