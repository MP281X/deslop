# Scope

Send OTLP/HTTP JSON to `/v1/traces` and `/v1/logs`: uncompressed, `application/json`, at most 1 MiB per export. Protobuf and gzip answer 415. Give exporters a service name that is not shaped like a GitHub repository (`owner/repo`): only the webhook below writes that shape, so such records answer as rejected in a partial success.

For GitHub Actions ingestion, create a repository webhook to `/v1/github` with JSON content and the _Workflow runs_ and _Workflow jobs_ events. Put its secret in `GITHUB_WEBHOOK_SECRET` in `~/.deslop/scope.env`, and give `GITHUB_TOKEN` Actions read access so job logs attach.
