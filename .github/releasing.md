# Releasing

## Simulator builds

A branch push touching a mobile app or shared packages builds a missing `<app>-simulator-<fingerprint>` artifact. The app holds the JavaScript of the commit that built it, so embed the branch's bundle before installing it:

```bash
fingerprint=$(cd apps/stash && APP_VARIANT=development npx --yes eas-cli@latest fingerprint:generate --platform ios --build-profile simulator --json --non-interactive | jq -r .hash)
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-$fingerprint" --jq '[.artifacts[] | select(.expired | not)][0].workflow_run.id')
gh run download $run --name stash-simulator-$fingerprint --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios   # config check before a native change
```

opm and trips build the same way, with bundle `xyz.mp281x.<app>.dev`. To sign a Simulator build in, tap Sign in with GitHub, then Continue.

## Deploy

Every push to `main` runs `deploy.yaml`: Verify, then the npm packages and each mobile app's EAS Update, or its App Store build for a native fingerprint without one shipped in the last 80 days, so TestFlight never drops the installed build. An app publishes as `@deslop/<app>` only when what it ships changed; one never published is skipped with a warning until **Publish a package**.

Each worker runs its apps as user services (`npm install --global @deslop/<app>`, then `<app> service install` with the flags `<app> --help` lists), which pick up a newer release within 15 minutes or at once with `<app> service update`. A release is live when each app's `/api/runtime` reports the new version and Scope's `/health` returns 200.

## Native tools

To update Stash's FFmpeg, ffprobe or yt-dlp or Deploy's Caddy, take the upstream Linux x64 release, replace its license file (FFmpeg's names its version and build), then `zstd -19 --long=27 <tool> -o apps/<app>/bin/<tool>.zst`, staying below GitHub's 100 MB file limit.

## Publish a package

Release publishes every app and tool as `0.1.<run>` with npm trusted publishing, which npm accepts only for a package that already exists.

1. **Shape.** Copy `tools/coding-standards/package.json`'s publish fields and its `pack.deps`, using version `0.1.0` and keeping `repository.url` unchanged for provenance: bundle everything except native-binary packages, packages sharing a module instance with them, and packages resolved by name at run time, which go in `dependencies`.
2. **Prove** the packed tarball, never the source: `PACK=$(mktemp -d) && vp -C tools/<name> run build && vp -C tools/<name> pm pack --pack-destination "$PACK" && vpx --package "$PACK"/deslop-<name>-0.1.0.tgz <bin> --help`. An app builds, runs `npm pkg delete dependencies devDependencies scripts main`, packs with `npm pack` and restores its `package.json`.
3. **First publish** by hand from the branch that adds it. Each command prints an npmjs.com URL for the account owner to approve within about five minutes: run it in the background and post the URL.

   ```bash
   npm whoami || script -qfc 'npm login --auth-type=web' /dev/null
   script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
   script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
   ```

4. A new tool joins Release's Build and Package steps beside `tools/coding-standards`; apps are discovered from `apps/*/package.json`.

## Publish an iOS app

1. **Register before pushing.** Check `npx --yes eas-cli@latest whoami` (`login --device` if needed). The generator's all-zero project ID counts as linked, so temporarily reduce `app.config.ts` to its `name`, `owner` and `slug`, run `init` in `apps/<name>`, and restore the config with the real UUID. Add `<name>://auth/callback` and `<name>-dev://auth/callback` to `allowedRedirect`.
2. **Prove the app** on the branch's Simulator build: sign in through both callback schemes, then complete a real action.
3. **Resolve production.** Every standalone build, credentials, submit or metadata command takes `APP_VARIANT=production` and an unused `RELEASE_NUMBER`; check the result before creating Apple records:

   ```bash
   APP_VARIANT=production RELEASE_NUMBER=<n> vp exec expo config --type public --json | jq '{name, scheme, version, ios, extra}'
   ```

4. **Bootstrap before the PR merges**, since the merge is the first non-interactive release. On the team's existing certificate and keys:
   - **Signing:** an App Store profile for the app and each extension target (`credentials -p ios`).
   - **Submission key:** the team's App Store Connect API key.
   - **App record:** only an interactive `submit` creates it; pass any existing file as the archive, copy the printed `ASC App ID` into `submit.production.ios.ascAppId` in `eas.json`, and stop it.
   - **Channel:** `channel:create production`.

   Drive the interactive commands through a pipe, answering each prompt; a cached Apple session answers Apple's:

   ```bash
   mkfifo /tmp/<task>/in && exec 3<>/tmp/<task>/in && APP_VARIANT=production script -qfc 'npx --yes eas-cli@latest submit -p ios --profile production --path <any file>' /tmp/<task>/out <&3   # in the background
   printf '\r' > /tmp/<task>/in
   ```

5. **Follow a release through.** The App Store job's log prints the submission URL; follow it until the build reaches the tester group:

   ```bash
   gh api --allow-escape-sequences repos/MP281X/deslop/actions/jobs/<job-id>/logs | rg -o 'https://expo\.dev/\S+/submissions/[0-9a-f-]+'
   APP_VARIANT=production npx --yes eas-cli@latest submit:view <submission-id> --json | jq '{status, error}'
   ```

   Report queued, uploaded, processing or available, with the submission URL and `https://appstoreconnect.apple.com/apps/<ascAppId>/testflight/ios`. Public TestFlight and App Store release are separate outward actions.
