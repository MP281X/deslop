# Deslop

Commands, Verify and the agent configuration live in the repository's `AGENTS.md`; this is the user's infrastructure around it.

## Apps

- **App.** The deslop `preview` project script runs the portfolio build for iteration, browser tests and captures.
- **Stash** has no worktree preview: the `stash` compose service on dev serves `https://stash.mp281x.xyz`, and the real notes in `~/.deslop/stash` are production data. The iPhone app and share sheet use the fixed public origin and shared Keychain credentials. Try its image with scratch data on another port: `mkdir -p /tmp/<task>/stash && vp -C apps/stash run build && docker build apps/stash -t stash:local && docker run --rm -d --env-file ~/.deslop/stash.env -p 127.0.0.1:5018:5000 -v /tmp/<task>/stash:/home/node/.deslop/stash stash:local`. The API and MCP require authorization even on loopback. `~/.deslop/stash.env` holds the variables in `apps/stash/.env.example`; `STASH_PROXY` is the user's DataImpulse residential plan "stash", with `__sessid.{session}` after the login.

## Simulator builds

The Simulator workflow builds each mobile app in `simulator.yaml` once per native fingerprint as the artifact `<app>-simulator-<fingerprint>`, on a branch push that changes what the native build reads; `<fingerprint>` is `(cd apps/<app> && APP_VARIANT=development npx --yes eas-cli@latest fingerprint:generate --platform ios --build-profile simulator --json --non-interactive | jq -r .hash)`. The app holds the JavaScript of the commit that built it, so embed the branch's bundle before you install it; `device_open` returns the `agent-device` command and its flags. A Swift change compiles first in that CI build.

```bash
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-<fingerprint>" --jq '[.artifacts[] | select(.expired | not)][0].workflow_run.id')
gh run download $run --name stash-simulator-<fingerprint> --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
<agent-device> install xyz.mp281x.stash.dev /tmp/stash-sim/stashdev.app <flags>
<agent-device> open xyz.mp281x.stash.dev <flags>
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios   # config check before a native change
```

opm and trips build the same way, with bundle `xyz.mp281x.<app>.dev`. To sign a Simulator build in, tap Sign in with GitHub, then Continue.

## Publish a new tool

Every push to `main` publishes the packages listed in `.github/workflows/deploy.yaml` as `0.1.<run>` with npm trusted publishing, which npm accepts only for a package that already exists.

1. **Shape.** Copy `apps/scope/package.json`'s publish fields (`version` `0.1.0`, `files: ["dist"]`, `publishConfig.access: public`, a `bin`, the `vp pack` build, `repository.url` unchanged since provenance checks it) and `apps/scope/vite.config.ts`'s `pack.deps.alwaysBundle`: bundle everything except native-binary packages, packages sharing a module instance with them, and packages resolved by name at run time, such as lint plugins, which go in `dependencies`.
2. **Prove** the packed tarball, never the source: `PACK=$(mktemp -d) && vp -C tools/<name> run build && vp -C tools/<name> pm pack --pack-destination "$PACK" && vpx --package "$PACK"/deslop-<name>-0.1.0.tgz <bin> --help`.
3. **First publish** by hand from the branch that adds it. Each command needs a terminal, so `script` gives it one, and prints an npmjs.com URL that the user (npm `matteo_paludgnach`) approves within about five minutes: run it in the background and post the URL. The registry answers 404 for a minute or two afterwards.

   ```bash
   npm whoami || script -qfc 'npm login --auth-type=web' /dev/null
   script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
   script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
   ```

4. Add `tools/<name>` to both package loops in `.github/workflows/deploy.yaml`.

## Publish an iOS app

Use the Simulator for iteration, TestFlight for distribution; the release path is `.github/workflows/deploy.yaml`.

1. **Register before pushing.** After the mobile generator, check `npx --yes eas-cli@latest whoami`; if needed, use `login --device` and give the user its URL, not a worker-local callback. The generated all-zero project ID counts as already linked: temporarily replace `app.config.ts` with a default export of only its generated `name`, `owner` and `slug`, without the runtime helper, project ID or updates URL. Run `init` in `apps/<name>`, then restore the generated config with the real UUID it prints before the first CI push. If init cannot write the dynamic config, apply its printed ID yourself, not another project creation. Add the app to the app loops in `deploy.yaml` and `simulator.yaml`, including the simulator trigger paths. Add `<name>://auth/callback` and `<name>-dev://auth/callback` to `allowedRedirect` in `apps/auth/src/services/authorizations/service.ts`.
2. **Prove the app.** Install the branch's Simulator build per Simulator builds, sign in through both callback schemes, then complete a real app action.
3. **Resolve production first.** Set `APP_VARIANT=production` on every standalone build, credentials, submission or metadata command; a submit profile does not inherit the build profile's environment. Set `RELEASE_NUMBER` to the intended unused release number, not the default zero. Inspect the resolved name, bundle identifier, scheme, project and version before creating Apple records:

   ```bash
   APP_VARIANT=production RELEASE_NUMBER=123 vp exec expo config --type public --json | jq '{name, scheme, version, ios, extra}' # replace 123 with the intended release
   ```

4. **Bootstrap before the app's PR merges.** Its merge is the first main release, and CI runs it non-interactively: `plan` stops when the project has no `production` branch, and the Mac's build and submit stop without credentials or an `ascAppId`. Have all four in place first, on the team's existing certificate and keys:
   - **Signing:** an App Store profile for the app and each extension target, from `credentials -p ios`.
   - **Submission key:** the team's App Store Connect API key (`XPDBFL4L6T`) set as the app's key for submissions.
   - **App record:** only an interactive `submit` creates it, because Apple's API cannot. It needs an archive but never inspects it before creating the record, so pass any existing file; CI submits the real build. It prints the `ASC App ID` for `submit.production.ios.ascAppId` in `eas.json`. Stop it once that is printed.
   - **Channel:** `channel:create production`, which also creates the `production` branch.

   Run the interactive commands yourself in a terminal fed through a pipe, then read the output and answer each prompt into the pipe. The Apple session that the user's last sign-in cached in `~/.app-store/auth` answers Apple's prompts. When it has expired, the user signs in again with the same command:

   ```bash
   mkfifo /tmp/<task>/in && exec 3<>/tmp/<task>/in && APP_VARIANT=production script -qfc 'npx --yes eas-cli@latest submit -p ios --profile production --path <any file>' /tmp/<task>/out <&3   # in the background
   printf '\r' > /tmp/<task>/in   # accepts the prefilled Apple ID
   ```

   Paid cloud builds need approval.

5. **Release and follow through.** Subsequent main releases use compatible EAS Updates or build a changed native fingerprint on CI's Mac and submit it. Inspect `submit:view <submission-id> --platform ios --json`, then `submit:status --platform ios --profile production --json --non-interactive`, with the production environment above, through to the intended tester group's access. Distinguish queued, uploaded, Apple processing and available. Return the submission URL and `https://appstoreconnect.apple.com/apps/<ascAppId>/testflight/ios`. CI's `--no-wait` proves scheduling only; inaccessible Apple status is unverified availability. Public TestFlight invitations and App Store release are separate outward actions, not implied by an upload. See the [EAS CLI reference](https://docs.expo.dev/eas/cli/#eas-submitstatus).

## Tracing

The `scope` compose service on dev receives trusted OTLP/HTTP JSON on `127.0.0.1:4318`, published on the tailnet as `https://dev.tailnet-8c4c.ts.net:4318` with `sudo tailscale serve --bg --https=4318 http://127.0.0.1:4318`. Public ingestion at `https://otel.mp281x.xyz/v1/traces` and `/v1/logs` requires a Deslop session cookie or audience-bound bearer. Port 4318 has no MCP route. Apps default to `http://localhost:4318`, so a preview exports only on dev; an allowed preflight does not prove spans.

## Deploy

1. **Apply.** The `deploy` compose service on dev applies main's commit each minute (its comment in `tools/compose.yaml`). Start the project, or apply a change to the `deploy` entry, from `~/deslop` on published main: `docker compose --project-name deslop --file tools/compose.yaml up -d`.
2. **Verify.** https://portfolio.mp281x.xyz and dev's http://127.0.0.1:4318/health return 200. Unauthenticated public OTLP and MCP requests return 401; each MCP challenge names its `/.well-known/oauth-protected-resource/mcp` metadata. After browser authorization, `scope`, `stash` and `auth` tools answer on their public `/mcp` URLs. An OPTIONS preflight to otel with `Origin: https://portfolio.mp281x.xyz` allows credentialed requests; verify an actual span too.
