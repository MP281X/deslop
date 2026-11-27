# Scope

Send OTLP/HTTP JSON to `/v1/traces` and `/v1/logs`: uncompressed `application/json`, at most 1 MiB per export. A service name shaped like `owner/repo` is reserved for the GitHub webhook below, so its records are rejected.

For GitHub Actions, a repository webhook to `/v1/github` with JSON content and the _Workflow runs_ and _Workflow jobs_ events; its secret is `GITHUB_WEBHOOK_SECRET` in `~/.deslop/scope.env`, beside a `GITHUB_TOKEN` with Actions read access for job logs.

On the Mac, run `vp run ios:sync` in this app to build and bundle its web client, then build the **App** scheme in `ios/App/App.xcodeproj`. Set `DESLOP_SERVER` to an HTTPS origin to try another Scope server.
