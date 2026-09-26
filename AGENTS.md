## Product scope

- Target this environment and the user's personal-software workflow only.
- Releases are linear and squash-merged. Apply data changes at every merged pull request.
- Local data is disposable. Preserve production data only from the immediately previous release; delete obsolete data.

## Pointers

- Coding judgement calls: CODING_STANDARDS.md.
- Enforcement owners: `tools/workflow` for types, the Oxlint config, and custom rules; `tsconfig.json` for jsx, lib, types, and exclude only; `vite.config.ts` for ignores, overrides, repository plugins, env, and the whole fmt config with the `@deslop` import group; `.fallowrc.json` for dead code.
- Generators: `vp create app -- --name <name>` and `vp create package -- --name <name>` with an unscoped kebab-case name, then `vp install` before anything else; `vp run shadcn add <component>`; `vp run upgrade`.
