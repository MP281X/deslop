# Releasing

Every push to `main` runs `deploy.yaml`: Verify, unless its branch already passed on the same tree, then the npm packages and, for each mobile app, its EAS Update or, for a native fingerprint without a build shipped in the last 80 days, its App Store build, so TestFlight never drops the installed build. An app publishes as `@deslop/<app>` only when what it ships changed; one never published is skipped with a warning until its first publish.

## A new app

After `vp create app -- --name <name>` (`--kind mobile` for iPhone) and `vp install`, the user does two things, each once: approve npm's first publish, and create the App Store Connect record. Everything else is the agent's or happens by itself.

1. **Expo** (agent, iPhone, before the first push). In `apps/<name>`, `npx --yes eas-cli@latest init --non-interactive --account mp281x.xyz` creates the project, then fails to write the dynamic config and prints its `extra.eas.projectId`: set it as `projectId` in `app.config.ts`. Then `npx --yes eas-cli@latest channel:create production --non-interactive`; Release's change check reads that branch.
2. **Sign-in** (agent, iPhone). Add `<name>://auth/callback` and `<name>-dev://auth/callback` to Auth's `allowedRedirect`.
3. **Signing** (agent, iPhone, once the branch is pushed). `gh workflow run app-store-signing.yaml --ref <branch> -f app=<name>`, then read its log with `gh run watch <run-id>` and `gh run view <run-id> --log`. It registers the bundle identifiers of the app and its extensions with their capabilities, and gives them the team's distribution certificate and new App Store profiles on Expo; releases then build with that signing and never change it. It is the one place this repository drives an interactive tool: it answers eas-cli's two prompts for a new app and stops on any other. Its failures:
   - **Already signed for the App Store**: an identifier already has an App Store profile, so there is nothing to set up.
   - **Unexpected prompt: Generate a new Apple Distribution Certificate?**: the team has no valid certificate on Expo; a new one is the user's call, made with `eas credentials`.
   - **Unexpected prompt: anything else**: eas-cli changed; add the prompt to the workflow only if its default is the intended answer.
   - **Apple answers 403**: the App Manager key reads apps, identifiers, certificates, profiles and TestFlight groups (checked), but creating identifiers and profiles is unproven; on a 403, generate a key with Admin access and replace `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8`.
4. **App Store Connect record** (user, once, after step 3, which makes the bundle ID selectable; Apple's API cannot create a record). At [App Store Connect](https://appstoreconnect.apple.com/apps), **+**, **New App**: iOS, any free name, English (U.S.), bundle ID `xyz.mp281x.<name>`, SKU `<name>`, full access. The agent posts this step with the link.
5. **npm** (agent, then user, before merging, so the merge's release proves the trust within npm's two days). Pack what Release publishes, restoring the manifest however packing ends, and run it:

   ```bash
   PACK=$(mktemp -d) && vp -C apps/<name> run build
   (cd apps/<name> && cp package.json "$PACK/manifest.json" && trap 'cp "$PACK/manifest.json" package.json' EXIT && npm pkg delete dependencies devDependencies scripts main && npm pack --pack-destination "$PACK")
   vpx --package "$PACK"/deslop-<name>-0.1.0.tgz <name> --help
   ```

   Then publish and trust it. Each command prints an npmjs.com URL for the user to approve within about five minutes: run it in the background and post the URL. Skipping two-factor checks for five minutes on the first approval lets the next command through without one.

   ```bash
   npm whoami || script -qfc 'npm login --auth-type=web' /dev/null
   script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
   script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
   ```

6. **TestFlight** (automatic, after the merge). Release finds the record by bundle ID, gives it an internal TestFlight group with every build and the testers of the team's other internal groups, builds, uploads and links the TestFlight page in the run's summary. Without a record the app's release fails, naming the bundle ID, the link and the `gh run rerun <run-id> --failed` that retries it once the record exists; the other apps still ship.

A new publishable tool, rather than an app, copies the publish fields from `tools/coding-standards/package.json` and `pack.deps` from its `vite.config.ts`, with version `0.1.0` and the same `repository.url`, and joins Release's Build and Package steps beside it; then its first publish as in step 5, packed with `vp -C tools/<name> pm pack`. A `vp create package` library is bundled into what uses it and never publishes.

## Follow a release

The App Store job uploads the `.ipa` from GitHub's Mac with `altool --upload-package` and fails on Apple's error before publishing the build's EAS Update; read it with `gh run view <run-id> --job <job-id> --log`. Upload is not processing: report uploaded, processing or available, with the run URL and the TestFlight URL from the run's summary. Public TestFlight and App Store release are separate outward actions.

Each worker runs its apps as user services (`npm install --global @deslop/<app>`, then `<app> service install` with the flags `<app> --help` lists), which pick up a newer release on their next update, about every 15 minutes while the worker is on, or at once with `<app> service update`. A release is live when each app's `/api/runtime` returns 200 and reports the new version.

## Simulator builds

A branch push touching a mobile app or shared packages builds a missing `<app>-simulator-<fingerprint>` artifact. The app holds the JavaScript of the commit that built it, so embed the branch's bundle before installing it:

```bash
fingerprint=$(cd apps/stash && APP_VARIANT=development npx --yes eas-cli@latest fingerprint:generate --platform ios --build-profile simulator --json --non-interactive | jq -r .hash)
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-$fingerprint" --jq '[.artifacts[] | select(.expired | not)][0].workflow_run.id')
gh run download $run --name stash-simulator-$fingerprint --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios   # config check before a native change
```

opm and trips build the same way, with bundle `xyz.mp281x.<app>.dev`. To sign a Simulator build in, tap Sign In, then Continue.

## Native tools

To update Stash's FFmpeg, ffprobe or yt-dlp or Deploy's Caddy, take the upstream Linux x64 release, replace its license file (FFmpeg's names its version and build), then `zstd -19 --long=27 <tool> -o apps/<app>/bin/<tool>.zst`, staying below GitHub's 100 MB file limit.
