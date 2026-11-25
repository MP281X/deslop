# Dual

The code is GitLab `dual/dual` on `git.datapizza.tech`.

## Accounts

Writes go only to GitHub `MP281X`, GitLab `matteopaludgnach` and the user's Discord test channel. Saved preview tokens are read-only; write tokens come from `gh auth token` and the `glab` configuration.

## AWS

The `aws` CLI's [default profile](maintenance.md#aws-cli) is only for Dual's resources, and read-only: never create, change, delete, start, stop or invoke anything, whatever the role allows, and leave the account's other projects alone. An expired session needs `aws sso login --sso-session datapizza --use-device-code --no-browser`: give the user the autofill URL once and end the turn.

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

The Dual project's `preview` script, from the worktree root: Dual's own preview stack, rewritten at each start to production builds without watchers, under the same stack and stage, so `stop` and `settle` stay Dual's. When Dual changes a rewritten line, the check stops it; update the rewrite, never Dual.

```bash
u=preview-${PWD##*/} h=$(hostname -s).tailnet-8c4c.ts.net a=infra/saas/.alchemy
# Vite gives `vite preview` the development server's backend proxy only when this flag is off.
mkdir -p $a && printf '%s\n' 'import config from "../../../packages/app/vite.config.ts";' \
  'export default env => config({ ...env, isPreview: false });' >$a/app.config.ts
# build:runtime builds the frame once, so its watcher becomes an idle process.
sed -e 's|"./local-preview.ts"|"../local-preview.ts"|; s|NODE_ENV: "development"|NODE_ENV: "production"|' \
  -e 's|command: "vp run build:runtime",|command: "vp run build:runtime \&\& vp run @dual/app#build", shell: true,|' \
  -e 's|command: "vp run watch:frame",|command: "sleep infinity",|' \
  -e 's|command: "vp run watch:api:preview",|command: "bun --no-env-file --cwd packages/saas src/dev.ts api",|' \
  -e 's|command: "vp run watch:worker:preview",|command: "PORT=$DUAL_WORKER_PORT exec bun --no-env-file --cwd packages/saas src/dev.ts preview-worker", shell: true,|' \
  -e 's|command: "vp run watch:app:preview",|command: "exec vp -C packages/app preview -c ../../infra/saas/.alchemy/app.config.ts --host 127.0.0.1 --port $DUAL_APP_PORT --strictPort", shell: true,|' \
  infra/saas/local.run.ts >$a/prod.run.ts
! grep -n 'watch:\|"development"' $a/prod.run.ts || { echo 'Dual changed its preview stack: update this rewrite' >&2; exit 1; }
sed 's|local\.run\.ts|.alchemy/prod.run.ts|' scripts/preview.sh >$a/prod.sh
systemctl --user stop $u 2>/dev/null; systemctl --user reset-failed $u 2>/dev/null
systemd-run --user -G -d -u $u -p KillSignal=SIGINT -p SuccessExitStatus=130 -E PATH="$HOME/.vite-plus/bin:$PATH" -E DUAL_PREVIEW_HOST=$h bash $a/prod.sh dev &&
  i=$(systemctl --user show -p InvocationID --value $u) &&
  until p=$(journalctl --user _SYSTEMD_INVOCATION_ID=$i -o cat | grep -oPm1 'Preview ready: \S+:\K[0-9]+'); do
    systemctl --user is-active -q $u || exit 1; sleep 5
  done &&
  sudo tailscale serve --bg --https=$p http://127.0.0.1:$p >/dev/null && d=$((SECONDS + 300)) &&
  # The URL prints only once it answers, so nobody starts on a 502.
  until [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 https://$h:$p/)" = 200 ]; do
    ((SECONDS < d)) || { journalctl --user _SYSTEMD_INVOCATION_ID=$i -o cat -n 20 >&2; exit 1; }; sleep 2
  done && echo https://$h:$p && echo 'Login: admin@dual.local / preview-password'
```

## Tracing

Add this to a development API or worker launch's environment to send it to Scope; production PostHog configuration stays:

```bash
OTEL_RESOURCE_ATTRIBUTES="scope.runtime=server,scope.run.started_unix_nano=$(date +%s%N)" \
POSTHOG_PROJECT_TOKEN=scope-dev POSTHOG_OTLP_BASE_URL=https://scope.mp281x.xyz
```
