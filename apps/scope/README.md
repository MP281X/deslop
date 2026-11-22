# Scope

Scope receives OTLP/HTTP JSON at `/v1/traces` and `/v1/logs`: uncompressed, `application/json`, at most 1 MiB per export. Protobuf and gzip answer 415. A service name shaped like a GitHub repository (`owner/repo`) is written only by the webhook below, so such records answer as rejected in a partial success.

For GitHub Actions ingestion, create a repository webhook to `/v1/github` with JSON content and the _Workflow runs_ and _Workflow jobs_ events. Put its secret in `GITHUB_WEBHOOK_SECRET` in `~/.deslop/scope.env`; `GITHUB_TOKEN` needs Actions read access to attach job logs.
