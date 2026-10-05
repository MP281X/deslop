# Tools

Each published tool is a package under `tools/` named `@deslop/<name>`: `coding-standards` and `media` today. The `create-*` generators are private workspace packages.

## Add a published tool

1. Create `tools/<name>` with `package.json`, `README.md`, an `AGENTS.md` symlink to it, `tsconfig.json` extending the root one and `vite.config.ts`. Copy the fields from `tools/media/package.json`: `version` stays `0.1.0` because CI sets the real version, `files` lists only `dist`, `publishConfig.access` is `public` and `scripts.build` is `vp pack`.
2. Bundle everything into `dist` with `pack.deps.alwaysBundle`, except a dependency that loads native binaries; declare that one in `dependencies`.
3. Add the path to `pnpm-workspace.yaml` and run `vp install`.
4. Prove the published shape, not the source: pack the tarball, install it in an empty project and run its binary.

```bash
vp -C tools/<name> run build
vp -C tools/<name> pm pack --pack-destination "$PWD/node_modules/.cache/deslop/publish"
```

## Publish a new tool for the first time

CI publishes with npm trusted publishing, and npm accepts that only for a package that already exists. Publish version `0.1.0` by hand from the branch that adds the tool, before the tool joins the CI loops:

```bash
npm whoami || script -qfc 'npm login --auth-type=web' node_modules/.cache/deslop/publish/login.log
script -qfc 'npm publish node_modules/.cache/deslop/publish/deslop-<name>-0.1.0.tgz --access public --auth-type=web' node_modules/.cache/deslop/publish/publish.log
script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' node_modules/.cache/deslop/publish/trust.log
npm trust list @deslop/<name>
```

- Each command writes an `https://www.npmjs.com/...` URL to its log and waits. Run it in the background, post the URL in the thread message (a question card cannot open links) and wait for the command to exit; an unapproved URL expires after about five minutes. The npm account `matteo_paludgnach` owns the `deslop` organization and approves the login and the publish; `npm trust` ran right after the publish approval without asking again. `script` supplies the terminal that npm needs to print the URL.
- The registry can answer 404 for a minute or two after a publish. Check once after that instead of polling.
- Then add `<name>` to both package loops in `.github/workflows/deploy.yaml`. The merge to `main` publishes `0.1.<run number>` through CI, which proves the trusted publisher.

## Releases

Every push to `main` runs `.github/workflows/deploy.yaml`. It sets each tool's version to `0.1.<run number>`, builds, packs with pnpm (which applies `publishConfig`) and uploads the tarball with `npm publish`. Do not publish with `vp pm publish`: pnpm 11 uploads without the README metadata, so npmjs.com shows no README. Do not bump versions in `package.json`.
