# Tools

Each published tool is a package under `tools/` named `@deslop/<name>`: `coding-standards` and `media` today. The `create-*` generators are private workspace packages.

## Add a published tool

1. Create `tools/<name>` with `package.json`, a real `README.md` (npm needs it), an `AGENTS.md` symlink to it, `tsconfig.json` extending the root one and `vite.config.ts`. Copy the fields from `tools/media/package.json`: `version` stays `0.1.0` because CI sets the real version, `files` lists only `dist`, `publishConfig.access` is `public` and `scripts.build` is `vp pack`.
2. Bundle everything into `dist` with `pack.deps.alwaysBundle`, except a dependency that loads native binaries; declare that one in `dependencies`.
3. Add dependencies with `vp -C tools/<name> add <package>@latest`; the `tools/*` workspace glob already includes the folder.
4. Prove the published shape, not the source: pack the tarball, install it in an empty project and run its binary. `vpx --package <tarball>` caches by path, so pack each rebuild to a new path.

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

- Each command writes an npmjs.com URL to its log and waits. Run it in the background, post the URL as a link and wait for the exit; the URL expires after about five minutes. The `deslop` owner, npm account `matteo_paludgnach`, approves the login and the publish; `npm trust` reuses the publish approval.
- The registry answers 404 for a minute or two after a publish.
- Then add `<name>` to both package loops in `.github/workflows/deploy.yaml`.

## Releases

Every push to `main` runs `.github/workflows/deploy.yaml`: it sets each tool's version to `0.1.<run number>`, builds, packs with pnpm, which applies `publishConfig`, and uploads with `npm publish`, which keeps the README metadata that pnpm 11 drops.
