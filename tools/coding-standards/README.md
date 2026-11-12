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

`map` prints what a commit range changed in the architecture and where its substance is, read from the code of both revisions rather than from anyone's summary, as Markdown a GitHub pull request body renders, or as JSON with `--json`.

```bash
coding-standards map                                   # HEAD against its merge base with origin's default branch
coding-standards map --base <commit> --head <commit>   # any range, such as a merged pull request's
vp run map --base <commit> --head <commit>             # the same from the repository; `vp run map -- …` passes `--`, which ends the options
```

It needs `git`, `tar` and Fallow on the `PATH`. Each revision is archived to a temporary directory with its workspace packages linked, so Fallow's module graph and the parser see that revision alone, not the working tree.

Every changed file is one of three kinds, from its top-level statements in both revisions (comments above a statement belong to it; line breaks, spacing beside punctuation, trailing commas and a namespace import's qualifier such as `WebRuntime.` are no change):

- **Imports only**: its statements are unchanged; its imports follow code that moved.
- **Moved**: git renamed it with no other change, or its declarations went to or came from other changed files. A declaration found with the same text in another file moved; one with the same name and at least half its lines in common moved and was edited.
- **Edited**: what remains, counted as the lines its edited, added and removed declarations differ by; a file outside the code counts git's lines.

The map then states:

- **Where the change is**: how many files only follow imports or only move, and the edited files, largest first.
- **Outside the main area**: edited files that no import, place or mention ties to the largest area: changed files joined by a direct import between them, one place (code's folder; a package for its other files; outside the packages, at most three folders deep, such as one skill), or dependency manifests; a file outside the packages, such as `AGENTS.md`, also joins the largest area its changed lines mention by package name, by a file name only that package has, or by an export the area changed. Configuration files are listed under Configuration instead. When these areas hold over a quarter of the changed lines, a warning says the change mixes unrelated work.
- **Packages**: which workspace packages import which, drawn when one such import is added or removed.
- **Moves**: files and exported declarations that changed folder, as arrows from the old folder to the new; declarations merged between files of one folder; declarations edited on the way; and a declaration a file dropped for an import of the same name.
- **Modules**: Fallow's import graph around the files that are not imports-only, with the before revision moved to the after revision's paths (a deleted file to the file most of its declarations went to) and a file that only follows imports keeping its imports, so only real dependency changes are marked. Each package starts at its deepest changed folder; past 12 boxes or 16 arrows, the package with the fewest changed files is drawn a folder higher, down to one box; package boxes with the same arrows merge. Unchanged imports are drawn around the change, then only between changed boxes, then only inside packages drawn in detail, whichever first fits. Tests are left out.
- **Services** of each touched app: a layer that provides service classes reads as providing them, its built services being the ones no other part needs; a diagram of what each service and layer yields is drawn only where a provider, a need or a layer's parts changed; a service whose code alone changed is named.
- **Contracts**, never folded: a package's export map as what each old specifier became, by following its module through its move to the entry serving it now, with modules a `*` entry newly exposes (tests aside); `Rpc.make` and `Tool.make` calls added, removed, edited or reaching a changed schema; routes from `router.add` and `HttpRouter.add` calls and page files under `apps/*/src/routes`; stored schemas.
- **Exports** added, removed or edited in place; a moved one is the moves' to report.
- **Schemas**: values built from `Schema` or `Model`, or classes extending them, that a file exports and changed; a `Model.Class` table row, a schema one reaches, or a schema a `KeyValueStore.toSchemaStore` document holds is stored, a contract.
- **Dependencies** from the lockfile: each importer's direct dependency added, removed or resolved to another version.
- **Configuration**: each changed setting of a `package.json` outside its dependencies and exports, `vite.config.ts`, `tsconfig*.json`, `.fallowrc.json` and the lint preset, as a person says it: an object added to a list as one line named by its first string field, a list's plain items as the ones gained and lost; changed lint rule sources, workflows and `pnpm-workspace.yaml` by file.
- **Suppressions** added or removed (lint, TypeScript, Fallow, Effect diagnostics and judge-ignore comments); one that moved with its code is no change.

A list over eight entries folds into counts per folder, then per package, such as `tools/coding-standards/src/lint: 7 added`; contracts never fold, and JSON keeps each entry. The diagrams say what they leave out.

Five rules are judgements rather than facts: an edited move needs half its lines in common, a deleted file is drawn where most of its declarations went, a file outside the packages joins an area by the words its changed lines share with it, the zoom limits of 12 boxes and 16 arrows, and the quarter of changed lines that makes a change mixed.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
