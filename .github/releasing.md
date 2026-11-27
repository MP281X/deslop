# Releasing

Actions use their major tag, such as `actions/cache@v6`, never a commit; `setup-vp` names its latest release, since its `v1` tag stopped at 1.15.

- **npm.** `matteo_paludgnach` approves a first publish's URL.
- **Apple.** Release archives the app and its extensions with ad hoc signatures, then uses the App Store Connect team API key in `ASC_KEY_ID`, `ASC_ISSUER_ID` and `ASC_KEY_P8` to have Xcode provision, [cloud sign](https://developer.apple.com/videos/play/wwdc2021/10204/) and upload them at export. The key needs the Admin role; if Apple denies signing access, the user checks the role and replaces the secrets if needed. No registered device, local distribution certificate or Apple sign-in.

## A new app

1. Add it by hand to `deploy.yaml`'s probe and Publish changed packages lists; an iPhone app also to Find iPhone builds without a TestFlight receipt and `simulator.yaml`.
2. iPhone, by the user before the first upload: register the app and extension IDs with the capabilities their entitlements need. At [App Store Connect](https://appstoreconnect.apple.com/apps), **+**, **New App**: iOS, a free name, English (U.S.), bundle `xyz.mp281x.<name>`, SKU `<name>`, full access. In its TestFlight tab, add an internal group with access to all builds and the other apps' testers.
3. First npm publish, from `apps/<name>`, packed as Release does:

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

4. Publish and trust print npmjs.com approval URLs that last about five minutes: run each in the background and show its URL. Merge within two days, or the trust record expires unused; then `npm trust list @deslop/<name>` shows its id, `npm trust revoke @deslop/<name> --id=<id>` removes it, and trust runs again.

```bash
npm whoami || script -qefc 'npm login --auth-type=web' /dev/null
script -qefc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
script -qefc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
```

A publishable tool uses `tools/coding-standards`' publish fields and `pack.deps`, starts at `0.1.0`, joins the Publish changed packages list as a tool, and packs with `vp -C tools/<name> pm pack` for its first publish. Generated libraries are bundled into their consumers, not published.

## Follow a release

Report each state with the run URL; read a failed job with `gh run view <run-id> --job <job-id> --log`. Push a `testflight/<name>` branch to verify and upload changed iPhone builds before merging, without publishing npm packages.

- **Apple.** Sign and upload to TestFlight succeeded and the run holds the `<app>-testflight-<fingerprint>` receipt. Apple refuses a build number twice, so a run that ended after the upload without its receipt can't be retried: the next release uploads that fingerprint again, as it does once a receipt expires after 80 days. Uploaded is not processed: check the app's TestFlight tab.
- **npm.** Each package that the Publish changed packages summary lists with a version answers it to `npm view @deslop/<name> version`; the public registry can take several minutes to serve a new version.
- **Production.** Each app's update timer installed the release: its `/api/runtime` answers 200 with the new version.

Public TestFlight and App Store release are separate outward actions.

## Simulator builds

`simulator.yaml` builds only a stack's top branch: it skips a branch that an open PR targets. The app bundles the web build of the commit that built it. From that commit's worktree, export the repository variable `DESLOP_DOMAIN` (`.env.example`) and download the matching build:

```bash
inputs=$(git rev-parse HEAD:apps/stash HEAD:packages HEAD:package.json HEAD:pnpm-lock.yaml HEAD:pnpm-workspace.yaml HEAD:vite.config.ts)
fingerprint=$(printf '%s\n' "$inputs" "$DESLOP_DOMAIN" | sha256sum | cut -c1-64)
recipe=$(git rev-parse HEAD:.github/workflows/simulator.yaml | sha256sum | cut -c1-12)
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-$fingerprint-$recipe" --jq '[.artifacts[] | select(.expired | not) | .workflow_run.id] | first // empty')
gh run download "$run" --name stash-simulator-$fingerprint-$recipe --dir /tmp/stash-sim
tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
```

The other iPhone apps build the same way.

## Native tools

To update Stash's FFmpeg, ffprobe or yt-dlp or Deploy's Caddy, take the upstream Linux x64 release, replace its license file (FFmpeg's names its version and build), then `zstd -19 --long=27 <tool> -o apps/<app>/bin/<tool>.zst`, below GitHub's 100 MB file limit.
