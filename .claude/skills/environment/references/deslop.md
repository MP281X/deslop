# Deslop

The user's own repository: no issue tracker, so the request is the whole task.

## Commands

Check and test run one after the other: rule tests create fixtures that a concurrent type scan reads. `--cache` replays the `check` script when its inputs are unchanged; the `test` task caches by default.

```bash
vp run -w fix && vp run -w --cache check && vp run -w test   # fix (lint fixes, then format), check (lint, types, Fallow), test
```

- **App.** The deslop `preview` project script runs the portfolio build for iteration, browser tests and captures.
- **Stash** has no worktree preview: the `stash` compose service on dev owns `127.0.0.1:5017`, published only on the tailnet with `sudo tailscale serve --bg --https=8443 http://127.0.0.1:5017`, and the real notes in `~/.deslop/stash`, which are production data. Try a change in its image on another port with a scratch data directory: `mkdir -p /tmp/<task>/stash && vp -C apps/stash run build && docker build apps/stash -t stash:local && docker run --rm -d --env-file ~/.deslop/stash.env -p 127.0.0.1:5018:5000 -v /tmp/<task>/stash:/home/node/.deslop/stash stash:local`, then `node apps/stash/dist/cli.js save '<link>' --server http://127.0.0.1:5018`. `~/.deslop/stash.env` holds the variables in `apps/stash/.env.example`; `STASH_PROXY` is the user's DataImpulse residential plan "stash", with `__sessid.{session}` after the login.
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

Every push to `main` publishes the packages listed in `.github/workflows/deploy.yaml` as `0.1.<run>` with npm trusted publishing, which npm accepts only for a package that already exists.

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

Scope receives unauthenticated OTLP/HTTP JSON directly at `http://127.0.0.1:4318` on dev and `https://otel.mp281x.xyz` from apps. `https://scope.mp281x.xyz` serves its authenticated UI and query RPC using the auth app. A remote preview needs a reachable `VITE_OTEL_URL`; an allowed preflight does not prove spans.

```bash
vpx @deslop/scope@latest login '<API key from https://auth.mp281x.xyz>'
vpx @deslop/scope@latest services
vpx @deslop/scope@latest traces --service @deslop/portfolio-server --since '10 minutes'
vpx @deslop/scope@latest trace <trace-id>
vpx @deslop/scope@latest watch --service @deslop/portfolio-server
```

The CLI defaults to the always-on `https://scope.mp281x.xyz`; `SCOPE_SERVER` or `--server` overrides it. Scope stores its SQLite database and CLI API key under `~/.deslop/scope/`. Its preview uses `NODE_ENV=development`, where the shared auth package supplies a mock developer without OAuth. Production defaults to real verification. Deslop exporters attach `scope.runtime`, `service.instance.id` and `scope.run.started_unix_nano`; the receiver hides an entire trace when any participating service moves to a newer run. Delayed batches cannot reactivate an old run.

Dual's existing `packages/saas/src/Observability.ts` already sends the same JSON protocol. In its development process only, set `POSTHOG_OTLP_BASE_URL` to the Scope base URL and `POSTHOG_PROJECT_TOKEN` to a nonempty development marker such as `scope-dev`; that token enables the exporter. Scope's private receiver does not authenticate that marker. Never replace Dual's production PostHog configuration.
