# @deslop/coding-standards

This package provides Vite+ lint and TypeScript presets and a `coding-standards` CLI. No skill files are installed.

```bash
vp add -D @deslop/coding-standards@latest @effect/tsgo@latest tsrs@latest
```

```ts
// vite.config.ts
import {defineConfig} from 'vite-plus'

import {lint} from '@deslop/coding-standards'

export default defineConfig({lint: {extends: [lint]}})
```

```jsonc
// package.json
{
	"scripts": {
		"prepare": "effect-tsgo patch --no-typescript --tsrs --oxlint",
		"check": "effect-tsgo --tsrs-lint vp lint --type-aware --type-check",
		"fix": "effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check || { coding-standards; exit 1; }"
	}
}
```

`coding-standards` with no flag prints the lint tactics, so `fix` ends a diagnostic autofix leaves with them, for the agent fixing it.

The preset leaves type-aware lint and type checking off, so a syntax-only pass stays possible; the two flags turn them on, and `--tsrs-lint` runs them on tsrs instead of Oxlint's tsgolint backend.

Native rules enforce function declarations, standalone `pipe`, no ternaries and Unicode regular expressions (`u` or `v`). The preset loads only `no-restricted-syntax` from `oxlint-plugin-eslint` to reject `let`, switches and binary `in` checks. These replacements report violations without the former custom migration fixes.

Custom rules retain the cases native rules cannot express: `prefer-predicate` owns runtime `typeof` and replaceable type-guard wrappers; `no-intermediate-collection` owns collections materialized only for a count, first item or emptiness check; `no-trivial-indirection` includes constant-return helpers and adjacent Option wrap/unwrap operations. Delimiter and schema encode/decode round trips are not assumed to preserve a value. Private derived-type aliases remain derived through generic wrappers. Boolean-name checks use explicit AST type annotations where available; Oxlint's JS plugin API exposes no TypeScript program, so opaque inferred calls remain outside that check.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Add your own ignores and opt into `deslopRules` for Deslop's own choices.

## Judge

`--judge` runs by hand, once per pull request after `fix` and the tests pass, then once more after its findings are fixed; never in CI or inside `fix`, `check` or `test`. Jev answers through a Deslop Gateway that spends the signed-in person's own OpenRouter key.

```bash
coding-standards sign-in                           # once per machine; approve its code in Auth or with answer_request
coding-standards --judge --ignore '**/*.gen.ts'    # by hand, once per pull request; never in CI
```

Questions address a single function, component or test case, not codebase-wide decisions. A question with a gate is asked only of the units it admits: a gate reads only what Jev reads, the unit's code and the imports it uses, and admits every unit the answer could be yes for. A gate that skips its own question's yes example fails the judge without a model call.

A unit's unanswered questions go to Jev together in one call. The answers live in one record per unit, keyed by its code and the imports it uses, in the user's cache directory (`~/.cache/coding-standards` on Linux), shared by every checkout and repository; each answer in it belongs to one question, so a run asks only edited code, and a reworded or added question asks only itself. A call missing one answer remembers nothing. Nothing expires: the folder can be deleted at any time, and the next run asks again.

The judge prints `path:line question message score` for findings, then a summary of units, questions asked, answered from memory and skipped by gates, calls and cost, and exits 1 on any finding or unanswered question. To suppress a finding, put `// judge-ignore <question> -- <reason>` in the comment lines above the unit; a suppression is reported once Jev clearly answers no or the question's gate skips the unit.

## Map

`map` prints what a commit range changed, read from the code of both revisions rather than from anyone's summary, as Markdown a GitHub pull request body renders, or as JSON with `--json` for the judge.

```bash
coding-standards map                                   # HEAD against its merge base with origin's default branch
coding-standards map --base <commit> --head <commit>   # any range, such as a merged pull request's
```

It needs `git`, `tar` and Fallow on the `PATH`. Each revision is archived to a temporary directory with its workspace packages linked, so Fallow's module graph and the parser see that revision alone, not the working tree.

- **Packages** with their files, lines and share of the change; `pnpm-lock.yaml` and `*.gen.*` files count apart, as generated.
- **Exports** added, removed or changed per file; whitespace is no change.
- **Routes** added or removed: `router.add` and `HttpRouter.add` calls with their method, and page files under `apps/*/src/routes`.
- **Schemas** exported from a `schema.ts` that changed; a `Model.Class` table row, a schema one reaches, or a schema a `KeyValueStore.toSchemaStore` document holds is marked stored.
- **Contracts**: `Rpc.make` and `Tool.make` calls that were added, removed or edited, or that reach a changed schema.
- **Dependencies** from the lockfile: each importer's direct dependency added, removed or resolved to another version.
- **Configuration**: each changed setting of a `package.json` outside its dependencies, `vite.config.ts`, `tsconfig*.json`, `.fallowrc.json` and the lint preset; changed lint rule sources, workflows and `pnpm-workspace.yaml` by file.
- **Suppressions** added or removed: lint, TypeScript, Fallow, Effect diagnostics and judge-ignore comments.
- **Areas**: changed files joined by a direct import between them, one place (code's folder; a package for its other files; outside the packages, at most three folders deep, such as one skill), or dependency manifests. A file outside the packages, such as `AGENTS.md`, a skill or a `.github` template, also joins the largest area its changed lines mention by package name, by a file name only that package has, or by an export the area changed. The largest area is the main one; every other is a candidate for an unrelated edit.
- **Diagrams** in Mermaid, each one picture of both revisions: the module graph around the changed modules from Fallow's import graph, and each touched app's services and layers with the services their code yields. Colour marks what changed, was added or was removed.

A list over eight entries folds into counts per folder, then per package, such as `tools/coding-standards/src/lint: 7 added`, so every change is still counted; JSON keeps each entry. Diagrams stop at 24 boxes and say what they leave out. A change over 60 files or 3,000 lines says it is too large to summarise honestly.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
