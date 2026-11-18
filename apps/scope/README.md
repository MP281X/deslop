# Scope

For GitHub Actions ingestion, create a repository webhook to `/v1/github` with JSON content and the _Workflow runs_ and _Workflow jobs_ events. Put its secret in `GITHUB_WEBHOOK_SECRET` in `~/.deslop/scope.env`; `GITHUB_TOKEN` needs Actions read access to attach job logs.
