# Deslop

## Commands

Check and test run one after the other: rule tests create fixtures that a concurrent type scan reads. `--cache` replays the `check` script when its inputs are unchanged; the `test` task caches by default.

```bash
vp run -w fix && vp run -w --cache check && vp run -w test   # fix (lint fixes, then format), check (lint, types, Fallow), test
```

- **App.** The deslop `preview` project script runs the portfolio build for iteration, browser tests and captures.
- **Stash** has no worktree preview: the `stash` compose service on dev owns `127.0.0.1:4319`, published only on the tailnet with `sudo tailscale serve --bg --https=4319 http://127.0.0.1:4319`, and the real notes in `~/.deslop/stash`, which are production data. Agents use its tools through the `stash` MCP server at `https://dev.tailnet-8c4c.ts.net:4319/mcp`; the iPhone app and its share sheet default to that address and change it under Filter, Server. Try a change in its image on another port with a scratch data directory: `mkdir -p /tmp/<task>/stash && vp -C apps/stash run build && docker build apps/stash -t stash:local && docker run --rm -d --env-file ~/.deslop/stash.env -p 127.0.0.1:5018:5000 -v /tmp/<task>/stash:/home/node/.deslop/stash stash:local`, then call `save` and `get` on `http://127.0.0.1:5018/mcp`. `~/.deslop/stash.env` holds the variables in `apps/stash/.env.example`; `STASH_PROXY` is the user's DataImpulse residential plan "stash", with `__sessid.{session}` after the login.
- **Agent configuration.** `.claude/agents/pair.md` and `.codex/instructions.md` are identical from `# Work` down; only `# Harness` differs. Shared skills live in `tools/coding-standards/skills/`; refresh the repository copies with `node tools/coding-standards/src/install.ts`. `.claude/skills/retrospective`, linked from `.codex/skills`, is repository-only; the workers' links are in maintenance's Agent configuration.
- **New mobile app.** After `vp create app -- --name <name> --kind mobile`, put the EAS project id from `npx eas-cli init` in `app.config.ts`, and after its first store build, `submit.production.ios.ascAppId` in `eas.json`.

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

1. **Shape.** Copy `apps/scope/package.json`'s publish fields: `version` `0.1.0`, `files: ["dist"]`, `publishConfig.access: public`, `scripts.build: vp pack`, and `repository.url` unchanged (provenance checks it). `pack.deps.alwaysBundle` bundles everything except native-binary packages, packages that share a module instance with them and packages resolved by name at run time, such as lint plugins, which go in `dependencies`.
2. **Prove** the packed tarball, never the source: `PACK=$(mktemp -d) && vp -C tools/<name> run build && vp -C tools/<name> pm pack --pack-destination "$PACK" && vpx --package "$PACK"/deslop-<name>-0.1.0.tgz deslop-<name> --help`.
3. **First publish** by hand from the branch that adds it. Each command needs a terminal, so `script` gives it one, and prints an npmjs.com URL that the user (npm `matteo_paludgnach`) approves within about five minutes: run it in the background and post the URL. The registry answers 404 for a minute or two afterwards.

   ```bash
   npm whoami || script -qfc 'npm login --auth-type=web' /dev/null
   script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" /dev/null
   script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' /dev/null
   ```

4. Add `tools/<name>` to both package loops in `.github/workflows/deploy.yaml`.

## Tracing

The `scope` compose service on dev receives unauthenticated OTLP/HTTP JSON on `127.0.0.1:4318`, published on the tailnet as `https://dev.tailnet-8c4c.ts.net:4318` with `sudo tailscale serve --bg --https=4318 http://127.0.0.1:4318`, and from the internet only at `https://otel.mp281x.xyz/v1/traces` and `/v1/logs`. Query it with the `scope` MCP server's tools (`services`, `traces`, `spans`, `logs`, `stats`, `trace`) at `https://dev.tailnet-8c4c.ts.net:4318/mcp`. A preview on desktop exports with `VITE_OTEL_URL=https://dev.tailnet-8c4c.ts.net:4318`; an allowed preflight does not prove spans.

Scope keeps its SQLite database in `~/.deslop/scope/`. Dual's development launch against Scope is in the Dual reference's Tracing.

## Deploy

1. **Apply.** The `deploy` compose service on dev applies main's commit each minute: that commit's `tools/compose.yaml` with the app images the release tagged with the commit, once all of them are pushed. Start the project with it, or apply a change to its own entry, from `~/deslop` on published main: `docker compose --project-name deslop --file tools/compose.yaml up -d`. Each tailnet app publishes its port, Scope's 4318 and the next ones upward, with `sudo tailscale serve --bg --https=<port> http://127.0.0.1:<port>`.
2. **Verify.** https://portfolio.mp281x.xyz and dev's http://127.0.0.1:4318/health return 200, an OPTIONS preflight to otel's `/v1/traces` and `/v1/logs` with `Origin: https://portfolio.mp281x.xyz` succeeds, and an MCP `initialize` to https://dev.tailnet-8c4c.ts.net:4318/mcp and :4319/mcp answers with `scope` and `stash`; both answer only on the tailnet.
