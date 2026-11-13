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
		"fix": "effect-tsgo --tsrs-lint vp lint --fix --type-aware --type-check || { coding-standards tactics; exit 1; }"
	}
}
```

Every action is a subcommand: `tactics`, `judge` or `sign-in`. `coding-standards` with no subcommand prints help; `coding-standards <subcommand> --help` describes that action's options.

`coding-standards tactics` prints the lint tactics, so `fix` ends a diagnostic autofix leaves with them, for the agent fixing it.

The preset leaves type-aware lint and type checking off, so a syntax-only pass stays possible; the two flags turn them on, and `--tsrs-lint` runs them on tsrs instead of Oxlint's tsgolint backend.

Native rules enforce function declarations, standalone `pipe`, no ternaries and Unicode regular expressions (`u` or `v`). The preset loads only `no-restricted-syntax` from `oxlint-plugin-eslint` to reject `let`, switches, binary `in` checks and RPC names other than `<service folder>.<verb>`. These replacements report violations without the former custom migration fixes.

Custom rules retain the cases native rules cannot express: `prefer-predicate` owns runtime `typeof` and replaceable type-guard wrappers; `no-intermediate-collection` owns collections materialized only for a count, first item or emptiness check; `no-trivial-indirection` includes constant-return helpers and adjacent Option wrap/unwrap operations. Delimiter and schema encode/decode round trips are not assumed to preserve a value. Private derived-type aliases remain derived through generic wrappers. Boolean-name checks use explicit AST type annotations where available; Oxlint's JS plugin API exposes no TypeScript program, so opaque inferred calls remain outside that check.

```jsonc
// tsconfig.json
{"extends": "@deslop/coding-standards/tsconfig.json"}
```

Add your own ignores and opt into `deslopRules` for Deslop's own choices.

## Judge

`judge` runs by hand, once per pull request after `fix` and the tests pass, then once more after its findings are fixed; never in CI or inside `fix`, `check` or `test`. Jev answers through a Deslop Gateway that spends the signed-in person's own OpenRouter key.

```bash
coding-standards sign-in                                  # once per machine; approve its code in Auth or with answer_sign_in
coding-standards judge --ignore '**/*.gen.ts'              # by hand, once per pull request; never in CI
coding-standards judge --dry-run --ignore '**/*.gen.ts'    # what it would ask and its estimated tokens; sends nothing
```

`judge` and `sign-in` share `--auth` and `--gateway` to choose their Deslop origins. `judge` also accepts `--base <ref>`, repeated `--ignore` globs and `--dry-run`; these options belong after the subcommand.

The judge judges the change: everything the working tree differs from its merge base with `--base`, by default the pull request's base branch on `origin`, else `origin`'s default branch, untracked files included and files the `--ignore` globs match left out. What the change says it does, its request, is the pull request's title and body when `gh pr view` finds one for the branch, else the messages of the commits since the merge base; a repository with no pull request host needs nothing more. A change with hunks and no request fails, and so does a repository whose base the judge cannot name.

Two levels of questions read it:

- **Change-level** questions read one hunk of the diff alone (whether it crosses a boundary or adds machinery), one hunk beside the request (whether it is unrelated to it), or one line of the request beside the whole request or commit message as its proof (whether it claims behavior nothing shows working). Lines in code fences or HTML comments, headings, table rules and lines holding only a link or a recording are not claims.
- **Line-level** questions read one function, component or test case whose lines, or the comment lines right above it, the change touched: its code with those comments and the imports it uses. A question with a gate is asked only of the units it admits: a gate reads only what Jev reads and admits every unit the answer could be yes for. A gate that skips its own question's yes example fails the judge without a model call.

Every question also answers its own two examples each run, from memory once answered, and a question that misjudges one fails the judge.

All the questions one state needs go to Jev together in one call. The answers live in one record per state, keyed by everything Jev reads of it (a unit's code, file and imports; a hunk's text, without line numbers, and file; the request; a claim and its proof), in the user's cache directory (`~/.cache/coding-standards` on Linux), shared by every checkout and repository. Each answer in a record belongs to one question and the model, so a run asks only what changed since the last one, a reworded or added question asks only itself, and a rewritten request asks again only the questions that read it. A call missing one answer remembers nothing. Nothing expires: the folder can be deleted at any time, and the next run asks again.

The judge prints `place question message score` for findings, where the place is `path:start-end` for a unit or a hunk and `pull request #n:line` or `commit <sha>:line` for a claim, and a change-level finding quotes the request's first line or the claim it is about before the score. A summary follows: the request's source; units, hunks and claims; questions asked by level, calls and estimated tokens; answers from memory and questions gates skipped; calls made, cost and time. It exits 1 on any finding or unanswered question. To suppress a finding on a unit or a hunk, put `judge-ignore <question> -- <reason>` in a comment line above the unit or inside the hunk; a suppression is reported once Jev clearly answers no or the question's gate skips the unit. A claim is answered in the request: show it working, or add a line saying it is not proven and why.

`--dry-run` signs nothing in and sends nothing: it prints one line per call the run would make, `place ~tokens: questions`, then the same summary, and exits 0. Tokens are the request body's characters over four.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
