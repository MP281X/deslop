# Dual

The code is GitLab `dual/dual` on `git.datapizza.tech`.

## Accounts

Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.

## AWS

On any profile, the `aws` CLI is only for reading Dual's resources: never create, change, delete, start, stop or invoke anything, whatever the role allows, and leave the account's other projects alone. An expired session of its [default profile](maintenance.md#aws-cli) needs `aws sso login --sso-session datapizza --use-device-code --no-browser`: give the user the autofill URL once and end the turn.

## Jira

Project `DOS`, board 1053, `https://datapizza.atlassian.net/browse/<key>`; the user's account ID is `712020:87e4f57e-6b5d-40ab-8dfa-faf159ead71a`.

- **Tools.** Dual's MCP `execute` (`dualos__execute` through the gateway), which finds its own `atlassian-api.*` tools, never `acli`. It signs in as a service account, so `currentUser()` and `@me` are not the user: name the account ID. `To Do` is `status = "To Do"`; `statusCategory` also returns Backlog. A slow or confusing step is a Dual defect for the final reply.
- **What to work on.** Rank unassigned To Do Epics, Tasks, Stories and Bugs by priority (P1 highest), size and fit with the code, and propose them. Once the user approves, assign each to him and apply transition 21 to Doing: the only Jira writes.
- **A ticket key** in a request, branch or commit: read it and quote the requirements used.

## Google

The same `execute` reads, never writes, the user's work calendar and mail, `matteopaludgnach@datapizza.tech` (`google-api.*`, calendar `primary`), in `Europe/Rome`. Its sandbox has no `Intl`: convert by the zone's offset.

## VPN

When `git.datapizza.tech`'s sign-in page stops answering, restart the session on dev; give the user the printed sign-in URL once, end the turn, and probe again once he confirms.

```bash
curl -fsS --max-time 5 https://git.datapizza.tech/users/sign_in >/dev/null || {
  openvpn3 session-manage --config datapizza --disconnect
  openvpn3 session-start --config datapizza --background
  # right after the start it prints "No sessions requires authentication interaction"
  timeout 55 bash -c 'until openvpn3 session-auth | rg -o "https://\S+"; do sleep 1; done'
}
```

## Preview

The Dual project's `preview` script rewrites Dual's own preview stack to production builds without watchers, under the same stack and stage, so Dual's `stop` and `settle` still apply. When Dual changes a rewritten line, the script's check stops it: update the rewrite in the project script with `t3_project_update`, never Dual.

## Tracing

Add this to a development API or worker launch's environment to send it to Scope; production PostHog configuration stays:

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://scope.mp281x.xyz
```
