# Dual

## Facts

- **One production instance.** Deployments stop and start it, with no rolling overlap.
- **Organizations.** One company each: B2B, no self sign-up. Names, ids and icons are visible to everyone in it. Access protects contents (prompts, steps, sub-workflow structure, Skill and Knowledge Base contents, Connection secrets) and lists, which show only what you were given; opening something without access says so.
- **Dependencies.** Sharing lends them only during a run: a Workflow's Connection works inside it, nowhere else, and never appears as yours.
- **Deploy sharing.** Grants Use: running it and seeing your own Runs.
- **Spaces.** Nesting is visual, never permission. Nobody requests access; someone invites you.
- **Migrations.** Model changes ship as one lossless database migration; no runtime path for old data.

## Workers

- **Accounts.** Writes only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens from `gh auth token` and the `glab` configuration.
- **Merge requests.** Squash-merged, stacks included; source branch deleted on merge.
- **Preview.** T3's `preview` script runs `bun run preview`: the worktree's database, sandbox, API, worker and app, without `.env` files, AWS or model keys. It prints its URL; sign in with username `admin@dual.local` and password `preview-password`.
  - **Restart.** After changing a published package; `settle` destroys its data.
  - **Webhooks.** Funnel `/api/webhooks` to the preview port, which proxies `/api` to the API.
  - **Google OAuth.** Register the printed origin plus `/api/connections/auth/callback`.

## Jira

Project `DOS`, board 1053, `datapizza.atlassian.net`; the user's account ID `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

- **Tools.** Use Dual's MCP `execute` (`dualos__execute` through the gateway), which finds its own tools (`atlassian-api.*`), not `acli`. It uses a service account: `currentUser()` and `@me` aren't the user, so name the account ID. `To Do` is `status = "To Do"` (`statusCategory` also returns Backlog); `Doing` is transition `21`. A slow or confusing step is a Dual defect for the final reply.
- **Picking.** On "what to work on": rank only unassigned `To Do` Epics, Tasks, Stories and Bugs by priority (`P1` highest), size and fit with the code. After approval, assign each to the user and move it to `Doing`: the only Jira writes.
- **Assigned.** A ticket key in a request, branch or commit is work the user started: read it, quote the requirements used.
- **Link.** `https://datapizza.atlassian.net/browse/<key>`.

## Google

The same `execute` reads, never writes, the user's work calendar and mail, `matteopaludgnach@datapizza.tech` (`google-api.*`, calendar `primary`), in `Europe/Rome`. No `Intl` in its sandbox: convert by the zone's offset.

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

- **Preview.** Exports nothing: trace a development launch.
- **Startup timestamp.** Fresh at every launch, so a restarted service hides its previous traces.
- **PostHog marker.** Nonempty enables the exporter, Scope ignores it; production PostHog configuration stays.

After `vp run build:runtime` at the root, from `packages/saas` with its development environment configured:

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://dev.tailnet-8c4c.ts.net:4318 \
bun --env-file .env src/dev.ts api
# Use the same launch environment with `src/dev.ts worker` for the worker.
```
