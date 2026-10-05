# Tools

Each published tool is a package under `tools/` named `@deslop/<name>`. The `create-*` generators are private workspace packages.

## Add a published tool

1. Create `tools/<name>` with `package.json`, the README and `AGENTS.md` pair that `CODING_STANDARDS.md` prescribes for published packages, `tsconfig.json` extending the root one and `vite.config.ts`. Copy the fields from `tools/media/package.json`: `version` stays `0.1.0` because CI sets the real version, `files` lists only `dist`, `publishConfig.access` is `public` and `scripts.build` is `vp pack`. `name`, `bin` and `repository.directory` name the new tool; `repository.url` stays, because npm provenance checks it. Remove `os` and `cpu` unless the tool has media's platform limits.
2. Bundle everything into `dist` with `pack.deps.alwaysBundle`, except dependencies that load native binaries, packages that must share one module instance with them and packages resolved by name at run time, such as lint plugins; declare those in `dependencies` and bundled packages the root does not already declare in `devDependencies`.
3. Add dependencies with `vp -C tools/<name> add <package>`, or `add -D` for bundled ones, and set their versions as `CODING_STANDARDS.md` prescribes; the `tools/*` workspace glob already includes the folder.
4. Prove the published shape, not the source: pack the tarball into a fresh directory, because `vpx --package <tarball>` caches by path, and run its binary.

```bash
vp -C tools/<name> run build
PACK=$(mktemp -d) && vp -C tools/<name> pm pack --pack-destination "$PACK"
vpx --package "$PACK"/deslop-<name>-0.1.0.tgz deslop-<name> --help
```

## Publish a new tool for the first time

CI publishes with npm trusted publishing, and npm accepts that only for a package that already exists. Publish version `0.1.0` by hand from the branch that adds the tool:

```bash
: "${PACK:?Set PACK to the pack directory from step 4}"
npm whoami || script -qfc 'npm login --auth-type=web' "$PACK"/login.log
script -qfc "npm publish $PACK/deslop-<name>-0.1.0.tgz --auth-type=web" "$PACK"/publish.log
script -qfc 'npm trust github @deslop/<name> --file deploy.yaml --repo MP281X/deslop --allow-publish --yes' "$PACK"/trust.log
npm trust list @deslop/<name>
```

- `npm login`, `npm publish` and `npm trust` each write an npmjs.com URL to their log and wait. Run each in the background, post the URL as a link and wait for the exit; the URL expires after about five minutes. The `deslop` owner, npm account `matteo_paludgnach`, approves the login and the publish; `npm trust` reuses the publish approval.
- The registry answers 404 for a minute or two after a publish.
- Then add `<name>` to both package loops in `.github/workflows/deploy.yaml`.

## Releases

Every push to `main` publishes each tool as `0.1.<run number>` through `.github/workflows/deploy.yaml`.
