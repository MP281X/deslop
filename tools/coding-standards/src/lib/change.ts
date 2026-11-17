import {Array, Boolean, Effect, Function, Number, Option, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {matches} from '#lib/ast.ts'
import {JudgeError} from '#lib/model.ts'

// The diff's every setting written out, so a machine's git configuration never changes which lines the change touched; it reads every file as text, whatever the change's attributes say.
const DIFF = [
	'diff',
	'--no-color',
	'--no-ext-diff',
	'--histogram',
	'--src-prefix=a/',
	'--dst-prefix=b/',
	'-U0',
	'--find-renames',
	'--diff-filter=d',
	'--text',
	'--no-textconv'
]
const HUNK_HEADER = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/u

type PullRequest = typeof PullRequest.Type
const PullRequest = Schema.Struct({baseRefName: Schema.String, number: Schema.Finite})

const run = Effect.fnUntraced(function* (command: string, args: string[], cwd: string) {
	const child = yield* ChildProcess.make(command, args, {cwd, stderr: 'pipe', stdout: 'pipe'})
	const output = yield* Effect.all(
		[
			Stream.mkString(Stream.decodeText(child.stdout)),
			Stream.mkString(Stream.decodeText(child.stderr)),
			child.exitCode
		],
		{concurrency: 'unbounded'}
	)
	return {exitCode: output[2], stderr: output[1], stdout: output[0]}
}, Effect.scoped)

// Paths are read raw: git quotes none it prints, and the lists it prints end each path with a NUL.
const git = Effect.fnUntraced(function* (args: string[], cwd: string) {
	const result = yield* run('git', ['-c', 'core.quotePath=false', ...args], cwd)
	if (result.exitCode !== 0) return yield* JudgeError.make({message: `git ${Array.join(args, ' ')} failed`})
	return result.stdout
})

function fields(output: string) {
	return pipe(output, String.split('\u0000'), Array.filter(String.isNonEmpty))
}

// The lines of the file as it is now that a hunk adds, or that a removal sits before.
const changedLines = Effect.fnUntraced(function* (header: string, body: string[]) {
	const first = yield* pipe(
		String.match(HUNK_HEADER)(header),
		Option.flatMap(found => Number.parse(found[1] ?? '')),
		Effect.fromOption(() => JudgeError.make({message: `git printed a hunk header the judge cannot read: ${header}`}))
	)
	const positions = Array.scan(body, {changed: Option.none<number>(), next: first}, (at, line) => {
		if (String.startsWith('+')(line)) return {changed: Option.some(at.next), next: at.next + 1}
		if (String.startsWith('-')(line)) return {changed: Option.some(Number.max(at.next, 1)), next: at.next}
		return {changed: Option.none(), next: at.next + 1}
	})
	return Array.getSomes(Array.map(positions, at => at.changed))
})

// The runs of lines that each open with a line `opens` matches, up to the next one; lines before the first belong to none.
function between(lines: string[], opens: (line: string) => boolean) {
	const starts = Array.filter(Array.range(0, lines.length - 1), index =>
		pipe(lines, Array.get(index), Option.exists(opens))
	)
	return Array.map(starts, (start, order) => {
		const end = pipe(
			starts,
			Array.get(order + 1),
			Option.getOrElse(() => lines.length)
		)
		return pipe(lines, Array.drop(start), Array.take(end - start))
	})
}

// `git diff --name-status -z`: a status, then one path, or the old and new paths of a rename or copy; a record cut short fails, since the judge cannot tell which file it names.
const entriesOf = Effect.fnUntraced(function* (output: string) {
	const parts = fields(output)
	return yield* Effect.forEach(
		Array.unfold(0, index =>
			pipe(
				parts,
				Array.get(index),
				Option.map(status => {
					const pathAt =
						index +
						Boolean.match(matches(/^[RC]/u)(status), {onFalse: Function.constant(1), onTrue: Function.constant(2)})
					return [{index, pathAt, status}, pathAt + 1] as const
				})
			)
		),
		record =>
			Effect.gen(function* () {
				const path = yield* pipe(
					parts,
					Array.get(record.pathAt),
					Effect.fromOption(() => JudgeError.make({message: `git listed a ${record.status} change without its path`}))
				)
				// A rename or copy names its old path first; any other change but an addition had this path at the base.
				if (record.pathAt > record.index + 1) {
					return {before: Array.get(parts, record.index + 1), path, status: String.slice(0, 1)(record.status)}
				}
				return {before: Option.liftPredicate(path, () => record.status !== 'A'), path, status: record.status}
			}),
		{concurrency: 1}
	)
})

const defaultBranch = Effect.fnUntraced(function* (root: string) {
	const result = yield* run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root)
	if (result.exitCode !== 0) {
		return yield* JudgeError.make({
			message: 'No origin default branch; name the branch this change goes into with --base <ref>'
		})
	}
	return String.trim(result.stdout)
})

// The TypeScript files the change adds or edits against its merge base, untracked ones included, with the lines of each as it is now that the change touched; the diff only selects what is asked and is never sent.
export const change = Effect.fnUntraced(function* (base: Option.Option<string>) {
	const root = String.trim(yield* git(['rev-parse', '--show-toplevel'], '.'))
	const pullRequest = yield* pipe(
		run('gh', ['pr', 'view', '--json', 'baseRefName,number'], root),
		Effect.flatMap(
			Effect.fnUntraced(function* (result) {
				if (result.exitCode === 0) {
					return Option.some(yield* Schema.decodeEffect(Schema.fromJsonString(PullRequest))(result.stdout))
				}
				// A branch without a pull request, a repository without a remote, or a gh never signed in to any host: the base is origin's default branch. Any other failure, such as a rejected token or an unreachable host, fails, since the wrong base judges the wrong change.
				if (matches(/no pull requests found|no git remotes found|To get started with GitHub CLI/u)(result.stderr))
					return Option.none<PullRequest>()
				return yield* JudgeError.make({message: `gh pr view failed: ${String.trim(result.stderr)}`})
			})
		),
		// No gh on this machine: a repository without a pull request host.
		Effect.catchTag('PlatformError', () => Effect.succeedNone)
	)
	const baseRef = yield* pipe(
		base,
		Option.orElse(() => Option.map(pullRequest, found => `origin/${found.baseRefName}`)),
		Option.match({onNone: () => defaultBranch(root), onSome: Effect.succeed})
	)
	const mergeBase = String.trim(yield* git(['merge-base', baseRef, 'HEAD'], root))
	const pathspec = [
		':(top,glob)**/*.ts',
		':(top,glob)**/*.tsx',
		...Array.map(
			['**/*.gen.ts', 'packages/components-web/src/ui/**', 'tools/*/template/**'],
			glob => `:(top,exclude,glob)${glob}`
		)
	]
	const tracked = yield* entriesOf(
		yield* git([...DIFF, '--name-status', '-z', '--no-relative', mergeBase, '--', ...pathspec], root)
	)
	// Each section of the patch is the file the NUL-separated list names at the same place, so no path is read from the patch's own text.
	const sections = between(
		String.split(yield* git([...DIFF, '--no-relative', mergeBase, '--', ...pathspec], root), '\n'),
		String.startsWith('diff --git ')
	)
	if (sections.length !== tracked.length) {
		return yield* JudgeError.make({
			message: `git diff named ${tracked.length} changed files but printed ${sections.length}; the judge cannot tell which section is which file`
		})
	}
	return {
		files: [
			...(yield* pipe(
				tracked,
				Array.zip(sections),
				Effect.forEach(
					pair =>
						pipe(
							between(pair[1], String.startsWith('@@ ')),
							Effect.forEach(hunk => changedLines(hunk[0] ?? '', Array.drop(hunk, 1)), {concurrency: 1}),
							Effect.map(hunks => ({...pair[0], touched: Array.flatten(hunks)}))
						),
					{concurrency: 1}
				)
			)),
			// An untracked file is new, so every unit in it is asked.
			...Array.map(
				fields(yield* git(['ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspec], root)),
				path => ({before: Option.none<string>(), path, status: 'A', touched: Array.empty<number>()})
			)
		],
		mergeBase,
		root,
		source: Option.match(pullRequest, {
			onNone: () => `the change since ${baseRef}`,
			onSome: found => `pull request #${found.number} into ${baseRef}`
		})
	}
})

// A file's text at the base of the change.
export const sourceAt = Effect.fnUntraced(function* (root: string, mergeBase: string, path: string) {
	return yield* git(['show', `${mergeBase}:${path}`], root)
})
