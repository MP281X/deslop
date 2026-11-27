# Scope

Send OTLP/HTTP JSON to `/v1/traces` and `/v1/logs`: uncompressed `application/json`, at most 1 MiB per export. A service name shaped like `owner/repo` is reserved for the GitHub webhook below, so its records are rejected.

For GitHub Actions, a repository webhook to `/v1/github` with JSON content and the _Workflow runs_ and _Workflow jobs_ events; its secret is `GITHUB_WEBHOOK_SECRET` in `~/.deslop/scope.env`, beside a `GITHUB_TOKEN` with Actions read access for job logs.

On the Mac, run `vp run iphone:prepare` and install the generated project's CocoaPods dependencies. Build its Release scheme in Xcode. The default server is `https://scope.mp281x.xyz`; set `EXPO_PUBLIC_APP_URL` to use a different HTTPS origin. Use the same generated project and origin for `vp run build:iphone` so the update matches the installed app's native fingerprint.
