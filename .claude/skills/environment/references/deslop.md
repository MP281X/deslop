# Deslop

The user's own repository: no issue tracker, so the request is the whole task.

## Commands

Check and test run one after the other: rule tests create fixtures that a concurrent type scan reads. `--cache` replays the `check` script when its inputs are unchanged; the `test` task caches by default.

```bash
vp run -w fix && vp run -w --cache check && vp run -w test   # fix (lint fixes, then format), check (lint, types, Fallow), test
```

- **App.** The deslop `preview` project script runs the portfolio build for iteration, browser tests and captures.
- **Stash** has no worktree preview: the running stash on dev owns port 5017 and the real notes in `~/.deslop/stash`, which are production data. `vp -C apps/stash run preview` serves `dist/server.js` on `127.0.0.1:5017`, published only on the tailnet with `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017`; never bind it to `0.0.0.0` on dev. `~/.deslop/stash.env` holds the variables in `apps/stash/.env.example`; `STASH_PROXY` is the user's DataImpulse residential plan "stash", with `__sessid.{session}` after the login.
- **Agent configuration.** `.claude/agents/pair.md` and `.codex/instructions.md` are identical from `# Work` down; only `# Harness` differs. Shared skills live in `tools/coding-standards/skills/`; refresh the repository copies with `node tools/coding-standards/src/install.ts`. `.claude/skills/retrospective`, linked from `.codex/skills`, is repository-only and never installed on the workers; the personal skills reach Codex only through the global links, so Codex lists each skill once. The workers run the configuration on `main` through symlinks per maintenance's Agent configuration.

## Stash simulator

The Simulator workflow builds the app once per native fingerprint as the artifact `stash-simulator-<fingerprint>`, only for a push that changes `apps/stash`, `packages` or the lockfile. The app holds the JavaScript of the commit that built it, so embed the branch's bundle before you install it; `device_open` returns the `agent-device` command and its flags. A Swift change compiles first in that CI build.

```bash
run=$(gh api "repos/MP281X/deslop/actions/artifacts?name=stash-simulator-<fingerprint>" --jq '.artifacts[0].workflow_run.id')
gh run download $run --name stash-simulator-<fingerprint> --dir /tmp/stash-sim && tar -xzf /tmp/stash-sim/simulator.tar.gz -C /tmp/stash-sim
APP_VARIANT=development vp -C apps/stash exec expo export:embed --platform ios --dev false --bundle-output /tmp/stash-sim/stashdev.app/main.jsbundle --assets-dest /tmp/stash-sim/stashdev.app
<agent-device> install xyz.mp281x.stash.dev /tmp/stash-sim/stashdev.app <flags>
<agent-device> open xyz.mp281x.stash.dev <flags>
vp -C apps/stash exec expo prebuild --platform ios --no-install --clean && rm -rf apps/stash/ios   # config check before a native change
```

## Publish a new tool

Every push to `main` publishes each `tools/*` package in `.github/workflows/deploy.yaml` and `apps/stash` as `0.1.<run>` with npm trusted publishing, which npm accepts only for a package that already exists.

1. **Shape.** Copy `apps/stash/package.json`'s publish fields: `version` `0.1.0`, `files: ["dist"]`, `publishConfig.access: public`, `scripts.build: vp pack`, and `repository.url` unchanged (provenance checks it). `pack.deps.alwaysBundle` bundles everything except native-binary packages, packages that share a module instance with them and packages resolved by name at run time, such as lint plugins, which go in `dependencies`.
2. **Prove** the packed tarball, never the source: `PACK=$(mktemp -d) && vp -C tools/<name> run build && vp -C tools/<name> pm pack --pack-destination "$PACK" && vpx --package "$PACK"/deslop-<name>-0.1.0.tgz deslop-<name> --help`.
3. **First publish** by hand from the branch that adds it. Each command needs a terminal, so `script` gives it one, and prints an npmjs.com URL that the user (npm `matteo_paludgnach`) approves within about five minutes: run it in the background and post the URL. The registry answers 404 for a minute or two afterwards.

   ```bash
   npm whoami || script -qfc 'npm login --auth-type=web' /dev/null
   script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
   script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
   ```

4. Add `tools/<name>` to both package loops in `.github/workflows/deploy.yaml`.

## Tracing

On dev only: collector `http://127.0.0.1:4318`, Jaeger `http://127.0.0.1:16686`, CORS for the production portfolio origin and loopback. A remote preview needs a reachable `VITE_OTEL_URL`. An allowed preflight does not prove spans.

```bash
curl -fsSG http://127.0.0.1:16686/api/traces --data-urlencode 'service=@deslop/portfolio-server' --data-urlencode 'lookback=10m' --data-urlencode 'limit=20' | jq '.data[] | {traceID, spans: [.spans[] | {operationName, duration}]}'
docker compose --project-name deslop --file tools/compose.yaml logs --since 10m collector
```
