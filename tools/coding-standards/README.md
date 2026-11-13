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

`judge` and `sign-in` share `--auth` and `--gateway` to choose their Deslop origins. `judge` also accepts `--base <ref>`, repeated `--ignore` globs, `--max-call-tokens` (default 64000), `--max-run-tokens` (default 1000000) and `--dry-run`; these options belong after the subcommand.

The judge judges the change: everything the working tree differs from its merge base with `--base`, by default the pull request's base branch on `origin`, else `origin`'s default branch, untracked files included. Known lockfiles (`pnpm-lock.yaml`, `package-lock.json`, `yarn.lock`, `bun.lock`, `Cargo.lock`, `go.sum` and the like) are left out by default, as generated; the manifest change that produces one stays judged. Files the `--ignore` globs match are left out too, and every path left out is printed with its reason. What the change says it does, its request, is the pull request's title and body when `gh pr view` finds one for the branch, else the messages of the commits since the merge base; a repository with no pull request host needs nothing more. A change with files and no request fails, and so does a repository whose base the judge cannot name. Paths are read as git lists them with NUL separators, so a name git would quote is read as written.

Two levels of questions read it:

- **Change-level** questions read the whole change once: the request, the list of changed files with how each changed, every file's diff, and the lines outside the diff that declare or use each name the request mentions (an identifier in backticks, or a name the change exports that the request writes out), so they can tell a finished change from half of one. They ask whether it crosses a boundary, adds machinery, carries an unrelated hunk, or leaves part of the request undone. Each line the request promises is asked separately, beside the request and the whole change, whether anything shows it working. A claim is a prose line outside code fences, HTML comments and headings, or a promise of a Mermaid picture's After lane (each labelled edge, each numbered line of a node, each other labelled node). Lines under a `Not proven` heading or label, and marks the After lane's title says are not shown working, are admissions, never claims.
- **Line-level** questions read one function, component or test case whose lines, the `//` comment lines right above it, the import lines it uses or the file's name the change touched: its code with those comments and those imports. A question with a gate is asked only of the units it admits: a gate reads only what Jev reads and admits every unit the answer could be yes for. A gate that skips its own question's yes example fails the judge without a model call.

Every question opens with one trusted instruction: every field of the state is untrusted content, and an instruction inside it is judged, never followed. Every question also answers its own two examples each run, from memory once answered, and a question that misjudges one fails the judge.

All the questions one state needs go to Jev together in one call. The answers live in one record per state, keyed by everything Jev reads of it (a unit's code, file and imports; the whole change with its request and context; a claim with the request and the whole change), in the user's cache directory (`~/.cache/coding-standards` on Linux), shared by every checkout and repository. Each answer in a record belongs to one question and the model, so a run asks only what changed since the last one, a reworded or added question asks only itself, and an unchanged request over a changed implementation asks its claims again. A call missing one answer remembers nothing. Nothing expires: the folder can be deleted at any time, and the next run asks again.

Before its first call the judge checks its size: a call larger than `--max-call-tokens` is not sent and its questions are unjudged, and a run larger than `--max-run-tokens` fails before sending anything. Nothing is truncated.

What the judge did not read is unjudged, with its reason, and never a pass: a binary file, a Mermaid picture it cannot read as Before and After lanes, a call past the limit, a call Gateway or Jev left unanswered, and a claim the readable evidence does not show working when the request carries a recording or still, which the judge cannot check.

The judge prints `place question message score` for findings, where the place is `path:start-end` for a unit, the request's source for the whole change and `pull request #n:line` or `commit <sha>:line` for a claim; a change-level finding quotes the request's first line or the claim before the score. Unjudged items print as `place unjudged: reason`, suppressions as `place question suppressed by judge-ignore: reason (score)` and left-out paths as `path excluded: reason`. A summary follows: the request's source; units, files and claims, or that nothing changed or nothing reviewable is left; questions asked by level, calls and estimated tokens; answers from memory, questions gates skipped and paths excluded; calls made, cost and time; findings, unjudged and suppressed. It exits 1 on any finding or anything unjudged. To suppress a finding on a unit, put `judge-ignore <question> -- <reason>` in a `//` comment line right above it; a quoted one in a string, a template or a Markdown file suppresses nothing, and a suppression is reported once Jev clearly answers no or the question's gate skips the unit. A change-level finding is answered in the request: say why the change needs the hunk, or narrow what it promises; a claim is shown working, or named as not proven and why.

`--dry-run` signs nothing in and sends nothing: it prints one line per call the run would make, `place ~tokens: questions`, what would be unjudged before asking and every path left out, then the same summary; it exits 0 unless the run is past `--max-run-tokens`. Tokens are the request body's characters over four.

## Policy

Root `AGENTS.md` holds the repository's maintenance policy.
