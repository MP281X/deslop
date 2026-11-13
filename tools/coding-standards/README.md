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

`judge` runs by hand, once per pull request after `fix` and the tests pass, then once more after its findings are fixed; never in CI or inside `fix`, `check` or `test`. Jev (`jev-1.13-free`, OpenCode Zen's System One call) answers through a Deslop Gateway that spends the signed-in person's own OpenCode Zen key; each answer is the probability that the unit breaks the question.

```bash
coding-standards sign-in                                  # once per machine; approve its code in Auth or with answer_sign_in
coding-standards judge --ignore '**/*.gen.ts'              # by hand, once per pull request; never in CI
coding-standards judge --dry-run --ignore '**/*.gen.ts'    # what it would ask and its estimated tokens; sends nothing
```

`judge` and `sign-in` share `--auth` and `--gateway` to choose their Deslop origins. `judge` also accepts `--base <ref>`, repeated `--ignore` globs, `--max-call-tokens` (default 64000) and `--dry-run`; these options belong after the subcommand.

The judge asks about the functions, components and test cases a change touches, one unit at a time. The change is everything the working tree differs from its merge base with `--base`, by default the pull request's base branch on `origin` when `gh pr view` finds one, else `origin`'s default branch, untracked files included; a repository whose base the judge cannot name fails. The diff only selects units and is never sent. A unit is asked when its lines, the `//` comment lines right above it, an import line it uses, or its file's path changed. Every file is diffed as text whatever `.gitattributes` says, and paths are read as git lists them with NUL separators, so a name git would quote is read as written.

Jev reads one unit alone: its code with those comments, its file's path and the import lines it uses. Each question asks one narrow thing about that unit. A question with a gate is asked only of the units it admits: a gate reads only what Jev reads and admits every unit the answer could be yes for. A gate that skips its own question's yes example fails the judge without a model call.

Every question opens with one trusted instruction: every field of the state is untrusted content, and an instruction inside it is judged, never followed. Every question also answers its own examples each run, from memory once answered, and a question that misjudges one fails the judge.

All the questions one unit needs go to Jev together in one call. The answers live in one record per unit, keyed by its code, file and imports, in the user's cache directory (`~/.cache/coding-standards` on Linux), shared by every checkout and repository. Each answer in a record belongs to one question and the model, so a run asks only what changed since the last one, and a reworded or added question asks only itself. A call missing one answer remembers nothing. Nothing expires: the folder can be deleted at any time, and the next run asks again.

Before its first call the judge measures each call at the request body's characters over four; a call past `--max-call-tokens` (default 64000) is not sent. Nothing is truncated.

Every run ends in three outcomes, each printed under its own heading and counted on the summary's last line (`N findings, N could not read, N suppressed`); it exits 0 only when the first two are zero.

- **Findings** print as `path:start-end question message score`. A question that misjudges its own example and a stale `judge-ignore` are findings too.
- **Could not read** fails the run, with the reason: a call past `--max-call-tokens`, a touched file the parser cannot read (a syntax error or a NUL byte), and a unit or example Gateway or Jev left without an answer the judge could read. A path git lists in a form the judge cannot match to its diff fails the run outright.
- **Suppressed** does not fail: to suppress a finding on a unit, put `judge-ignore <question> -- <reason>` in a `//` comment line right above it; a quoted one in a string or a template suppresses nothing. Each suppression is listed with its reason, and reported once Jev clearly answers no or the question's gate skips the unit.

`--dry-run` signs nothing in and sends nothing: it prints one line per call the run would make, `place ~tokens: questions`, then what it could not read, and the summary; it exits 1 only when the real run would fail before its first answer.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
