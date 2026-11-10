# Scope

A debugger for Effect apps: it receives their traces and logs, and agents query them.

```bash
npm install --global @deslop/scope
scope service install --url https://scope.mp281x.xyz --auth https://auth.mp281x.xyz
```

- **Send** telemetry by starting other apps with `--traces https://scope.mp281x.xyz`.
- **GitHub Actions**: a repository webhook to `/v1/github` (content type JSON, events _Workflow runs_ and _Workflow jobs_) sends each run as a trace of its jobs and steps; Scope serves the route once `GITHUB_WEBHOOK_SECRET` in `~/.deslop/scope.env` holds the webhook's secret, and attaches each job's log to its step and job spans when `GITHUB_TOKEN` holds a token that can read Actions.

Common flags and service commands: [Deslop app runtime](https://github.com/MP281X/deslop/blob/main/packages/runtime/README.md).
