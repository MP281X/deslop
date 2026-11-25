# Releasing

- **History.** `main` is linear: every PR is squash-merged.
- **Actions.** Actions use their major tag, such as `actions/cache@v6`, never a commit; `setup-vp`'s `v1` stopped at 1.15, so it names its latest release.
- **Lists.** The workflows name every app by hand; nothing discovers them.

| Workflow                 | Does                                                                                                                                                                                                                                                                                                                         |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy.yaml` (Release)  | Verify checks, builds, probes each server and tests. On `main` it then publishes each iPhone app's EAS Update and the npm packages whose tarball changed, deletes up to 300 runs older than 14 days that hold no unexpired artifact, and starts a Mac for each iPhone app whose native fingerprint Apple has no receipt for. |
| `simulator.yaml`         | On a branch push no open PR targets (a stack's top), builds each iPhone app's missing Simulator artifact on a Mac.                                                                                                                                                                                                           |
| `app-store-signing.yaml` | Dispatched by hand: registers an app's identifiers and profiles with Apple.                                                                                                                                                                                                                                                  |

## A new app

1. Add it to `deploy.yaml`'s probe and Publish changed packages lists; an iPhone app also to the lists in Find the iPhone apps with a native change, Publish each iPhone app's EAS Update and `simulator.yaml`.
2. iPhone, before the first push: in `apps/<name>`, run `vpx eas-cli@latest init --non-interactive --account mp281x.xyz`; it prints `extra.eas.projectId` when writing dynamic config fails, so save that as `projectId` in `app.config.ts`. Then `vpx eas-cli@latest channel:create production --non-interactive`.
3. iPhone: push, then `gh workflow run app-store-signing.yaml --ref <branch> -f app=<name>` and read `gh run view <run-id> --log`. On "Generate a new Apple Distribution Certificate?" the user picks a new team certificate in `vpx eas-cli@latest credentials` in the app directory; add any other prompt to the workflow only if its default is the intended answer; on Apple 403, replace `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` with an Admin-access key. An already signed app's run gives its App ID what the app declares, with new profiles.
4. iPhone, user input after signing: at [App Store Connect](https://appstoreconnect.apple.com/apps), **+**, **New App**: iOS, a free name, English (U.S.), bundle `xyz.mp281x.<name>`, SKU `<name>`, full access. Then, in the app's TestFlight tab, an internal group with access to all builds and the testers of the other apps' groups.
5. First npm publish, from `apps/<name>`: pack as Release does. The subshell stops at the first failure and restores the manifest either way:

```bash
PACK=$(mktemp -d)
(
  set -e
  cp package.json "$PACK/manifest.json"
  trap 'cp "$PACK/manifest.json" package.json' EXIT
  vp run build
  npm pkg delete dependencies devDependencies scripts main
  vp pm pack --pack-destination "$PACK"
)
vpx --package "$PACK"/deslop-<name>-0.1.0.tgz <name> --help
```

6. Publish and trust print npmjs.com approval URLs lasting about five minutes: run each in the background and show its URL. Merge within two days, or the trust record expires unused; then `npm trust list @deslop/<name>` shows its id, `npm trust revoke @deslop/<name> --id=<id>` removes it, and trust runs again.

```bash
npm whoami || script -qefc 'npm login --auth-type=web' /dev/null
script -qefc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
script -qefc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
```

A publishable tool uses `tools/coding-standards`' publish fields and `pack.deps`, starts at `0.1.0`, joins the Publish changed packages list as a tool, and packs with `vp -C tools/<name> pm pack` for its first publish. Generated libraries are bundled into their consumers, not published.

## Follow a release

Read a failed job with `gh run view <run-id> --job <job-id> --log`, and report each state with the run URL:

- **Apple**: `altool --upload-package` succeeded and the run holds the `<app>-app-store-<fingerprint>` receipt. Apple refuses a build number twice, so a run that ended after the upload without its receipt can't be retried: the next release uploads that fingerprint again, as it does once a receipt expires after 80 days. Uploaded is not processed: check the app's TestFlight tab.
- **Update**: every release publishes each iPhone app's EAS Update to `production`; a phone takes it only on a build with the same fingerprint.
- **npm**: each package the Publish changed packages summary lists with a version answers it to `npm view @deslop/<name> version`.
- **Worker**: its update timer installed the release: `/api/runtime` returns 200 and reports the new version.

Public TestFlight and App Store release are separate outward actions.

## Simulator builds

Every command here and every workflow that loads an app's config reads `DESLOP_DOMAIN`, the repository variable of that name (`.env.example`); export it first. The artifact's recipe names this checkout's `simulator.yaml` and setup action, so a build is taken only from the same ones. The app holds the JavaScript of the commit that built it, so embed the branch's bundle before installing it:

```bash
# Run in apps/stash:
fingerprint=$(APP_VARIANT=development vpx eas-cli@latest fingerprint:generate --platform ios --build-profile simulator --json --non-interactive | jq -r .hash)
# Run the remaining commands from the worktree root:
recipe=$(git rev-parse HEAD:.github/workflows/simulator.yaml HEAD:.github/actions/setup | sha256sum | cut -c1-12)
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-$fingerprint-$recipe" --jq '[.artifacts[] | select(.expired | not) | .workflow_run.id] | first // empty')
gh run download "$run" --name stash-simulator-$fingerprint-$recipe --dir /tmp/stash-sim
tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean
rm -rf apps/stash/ios   # config check before a native change
```

opm and trips build the same way, with bundle `xyz.mp281x.<app>.dev`.

## Native tools

To update Stash's FFmpeg, ffprobe or yt-dlp or Deploy's Caddy, take the upstream Linux x64 release, replace its license file (FFmpeg's names its version and build), then `zstd -19 --long=27 <tool> -o apps/<app>/bin/<tool>.zst`, staying below GitHub's 100 MB file limit.
