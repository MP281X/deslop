# Releasing

How changes reach the iOS Simulator, production and npm; accounts and hosts are in the environment skill's Deslop reference.

## Simulator builds

`simulator.yaml` builds each mobile app once per native fingerprint as the artifact `<app>-simulator-<fingerprint>`, on a branch push that changes what the native build reads; a Swift change compiles first in that build. The app holds the JavaScript of the commit that built it, so embed the branch's bundle before installing it on a Simulator.

```bash
fingerprint=$(cd apps/stash && APP_VARIANT=development npx --yes eas-cli@latest fingerprint:generate --platform ios --build-profile simulator --json --non-interactive | jq -r .hash)
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-$fingerprint" --jq '[.artifacts[] | select(.expired | not)][0].workflow_run.id')
gh run download $run --name stash-simulator-$fingerprint --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios   # config check before a native change
```

opm and trips build the same way, with bundle `xyz.mp281x.<app>.dev`. To sign a Simulator build in, tap Sign in with GitHub, then Continue.

## Deploy

Every push to `main` runs Release (`deploy.yaml`): Verify, then side by side app npm artifacts/images with `@deslop/coding-standards`, and each mobile app's EAS Update, or its App Store build for a native fingerprint without one. An app's dependency-free `release/` directory is packed once; that exact tarball goes into its container and to npm. The `npm-apps` artifact retains the packages, including those awaiting their first publication.

All app images use `tools/app.Dockerfile` with `apps/<app>/package.tgz` as their build context artifact; there are no per-app runtime Dockerfiles. The first release of the npm app packages requires an owner-approved initial publish and trusted-publisher setup per **Publish a package**, using `apps/<app>/release`. Until each package exists, Release emits a warning and skips its npm upload; images and existing packages still ship. The new Deploy app is not installed in production and Traefik is not replaced by merging this PR. Install native services and migrate proxy ownership deliberately after the packages are available. Stash's bundled native-tool license/source requirements must accompany any redistributed artifact.

1. **Apply.** The `deploy` service in `tools/compose.yaml` applies main's commit each minute (its comment there). Start the project, or apply a change to the `deploy` entry, from a checkout on published main: `docker compose --project-name deslop --file tools/compose.yaml up -d`.
2. **Check.** https://portfolio.mp281x.xyz and the host's http://127.0.0.1:4318/health return 200. Unauthenticated public OTLP and MCP requests return 401; each MCP challenge names its `/.well-known/oauth-protected-resource/mcp` metadata. After browser authorization, every app serving `ServerRuntime.layerMcp` answers its tools on its public `/mcp` URL. An OPTIONS preflight to otel with `Origin: https://portfolio.mp281x.xyz` allows credentialed requests; verify an actual span too.

## Publish a package

Release publishes each package its Build and Package steps name as `0.1.<run>` with npm trusted publishing, which npm accepts only for a package that already exists.

1. **Shape.** Copy `tools/coding-standards/package.json`'s publish fields (`version` `0.1.0`, `files`, `publishConfig.access: public`, a `bin`, the `vp pack` build, `repository.url` unchanged since provenance checks it) and its `vite.config.ts`'s `pack.deps.alwaysBundle`: bundle everything except native-binary packages, packages sharing a module instance with them, and packages resolved by name at run time, such as lint plugins, which go in `dependencies`.
2. **Prove** the packed tarball, never the source: `PACK=$(mktemp -d) && vp -C tools/<name> run build && vp -C tools/<name> pm pack --pack-destination "$PACK" && vpx --package "$PACK"/deslop-<name>-0.1.0.tgz <bin> --help`. Apps instead build `apps/<name>` and pack `apps/<name>/release`; do not publish the Expo/workspace manifest.
3. **First publish** by hand from the branch that adds it. Each command needs a terminal, so `script` gives it one, and prints an npmjs.com URL for the npm account owner to approve within about five minutes: run it in the background and post the URL. The registry answers 404 for a minute or two afterwards.

   ```bash
   npm whoami || script -qfc 'npm login --auth-type=web' /dev/null
   script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
   script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
   ```

4. Version and pack `tools/<name>` beside `tools/coding-standards` in Release's Build and Package steps.

## Publish an iOS app

The Simulator is for iteration, TestFlight for distribution.

1. **Register before pushing.** After the mobile generator, check `npx --yes eas-cli@latest whoami`; if needed, use `login --device` and share its URL, not a worker-local callback. The generated all-zero project ID counts as already linked: temporarily replace `app.config.ts` with a default export of only its generated `name`, `owner` and `slug`, without the runtime helper, project ID or updates URL. Run `init` in `apps/<name>`, then restore the generated config with the real UUID it prints before the first CI push. If init cannot write the dynamic config, apply its printed ID yourself, not another project creation. Add the app's service to `tools/compose.yaml`, the app to the image loop and the app matrix in `deploy.yaml`, and to the app matrix and trigger paths in `simulator.yaml`. Add `<name>://auth/callback` and `<name>-dev://auth/callback` to `allowedRedirect` in `apps/auth/src/services/tokens/lib/utils.ts`.
2. **Prove the app.** Install the branch's Simulator build per Simulator builds, sign in through both callback schemes, then complete a real app action.
3. **Resolve production first.** Set `APP_VARIANT=production` on every standalone build, credentials, submission or metadata command; a submit profile does not inherit the build profile's environment. Set `RELEASE_NUMBER` to the intended unused release number, not the default zero. Inspect the resolved name, bundle identifier, scheme, project and version before creating Apple records:

   ```bash
   APP_VARIANT=production RELEASE_NUMBER=123 vp exec expo config --type public --json | jq '{name, scheme, version, ios, extra}' # replace 123 with the intended release
   ```

4. **Bootstrap before the app's PR merges.** Its merge is the first main release, and CI runs it non-interactively: the app's Update job stops when the project has no `production` branch, and the Mac's build and submit stop without credentials or an `ascAppId`. Have all four in place first, on the team's existing certificate and keys:
   - **Signing:** an App Store profile for the app and each extension target, from `credentials -p ios`.
   - **Submission key:** the team's App Store Connect API key, set as the app's key for submissions.
   - **App record:** only an interactive `submit` creates it, because Apple's API cannot. It needs an archive but never inspects it before creating the record, so pass any existing file; CI submits the real build. It prints the `ASC App ID` for `submit.production.ios.ascAppId` in `eas.json`. Stop it once that is printed.
   - **Channel:** `channel:create production`, which also creates the `production` branch.

   Run the interactive commands in a terminal fed through a pipe, then read the output and answer each prompt into the pipe; a cached Apple session answers Apple's prompts:

   ```bash
   mkfifo /tmp/<task>/in && exec 3<>/tmp/<task>/in && APP_VARIANT=production script -qfc 'npx --yes eas-cli@latest submit -p ios --profile production --path <any file>' /tmp/<task>/out <&3   # in the background
   printf '\r' > /tmp/<task>/in   # accepts the prefilled Apple ID
   ```

5. **Release and follow through.** Later main releases ship compatible EAS Updates or build a changed native fingerprint on CI's Mac and submit it; the App Store job's log prints the submission URL, whose last segment is its ID. Inspect `submit:view <submission-id> --json` (an ID takes no platform flag), then `submit:status --platform ios --profile production --json --non-interactive` until a build numbered with the release run appears, with the production environment above, through to the intended tester group's access:

   ```bash
   gh api --allow-escape-sequences repos/MP281X/deslop/actions/jobs/<job-id>/logs | rg -o 'https://expo\.dev/\S+/submissions/[0-9a-f-]+'
   APP_VARIANT=production npx --yes eas-cli@latest submit:view <submission-id> --json | jq '{status, error}'
   ```

   Distinguish queued, uploaded, Apple processing and available. Return the submission URL and `https://appstoreconnect.apple.com/apps/<ascAppId>/testflight/ios`. CI's `--no-wait` proves scheduling only; inaccessible Apple status is unverified availability. Public TestFlight invitations and App Store release are separate outward actions, not implied by an upload. See the [EAS CLI reference](https://docs.expo.dev/eas/cli/#eas-submitstatus).
