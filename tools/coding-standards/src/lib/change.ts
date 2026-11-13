import {Array, Boolean, Effect, HashSet, Number, Option, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {matches} from '#lib/ast.ts'
import {JudgeError} from '#lib/session.ts'

// The diff's every setting written out, so a machine's git configuration changes neither the hunks nor the answers keyed by them.
const DIFF = ['diff', '--no-color', '--no-ext-diff', '--histogram', '--src-prefix=a/', '--dst-prefix=b/', '-U3']
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u
// What a file's header says beside its hunks: added, deleted, renamed, binary or a new mode.
const STATUS = /^(?:new file mode|deleted file mode|rename from|rename to|Binary files|old mode|new mode)/u
// Lines of a request that state nothing: headings, table rules, a recording or image alone on its line, and HTML that only wraps.
const SILENT =
	/^(?:#|\|[\s|:-]+\||!\[[^\]]*\]\([^)]*\)$|<\/?(?:details|summary|video|img|picture|source|p|br)\b|https?:\/\/\S+$|-\s*\[[ x]\]\s*$)/iu

// A hunk of the change: where its changed lines sit, and its text without line numbers, so code moving down the file is not asked again.
export type Hunk = {end: number; file: string; ignores: HashSet.HashSet<string>; start: number; text: string}

type PullRequest = typeof PullRequest.Type
const PullRequest = Schema.Struct({
	baseRefName: Schema.String,
	body: Schema.String,
	number: Schema.Finite,
	title: Schema.String
})

const run = Effect.fnUntraced(function* (command: string, args: string[], cwd: string) {
	const handle = yield* ChildProcess.make(command, args, {cwd, stderr: 'ignore', stdout: 'pipe'})
	const output = yield* Effect.all([Stream.mkString(Stream.decodeText(handle.stdout)), handle.exitCode], {
		concurrency: 'unbounded'
	})
	return {exitCode: output[1], stdout: output[0]}
}, Effect.scoped)

const git = Effect.fnUntraced(function* (args: string[], cwd: string) {
	const result = yield* run('git', args, cwd)
	// `git diff --no-index` exits 1 when the two sides differ, which is every untracked file it is asked about.
	if (result.exitCode !== 0 && !(result.exitCode === 1 && Array.contains(args, '--no-index'))) {
		return yield* JudgeError.make({message: `git ${Array.join(args, ' ')} failed`})
	}
	return result.stdout
})

// The lines of a request worth asking about, outside code fences and HTML comments, each with where it was written and the evidence written beside it.
function claimsOf(text: string, where: (line: number) => string, proof: string) {
	const lines = pipe(text, String.split('\n'), Array.map(String.trim))
	// Whether each line sits in a fence or a comment, or opens or closes one.
	const hidden = Array.scan(lines, {comment: false, fence: false, hidden: false}, (state, line) => {
		const fence = String.startsWith('```')(line)
		const opens = String.includes('<!--')(line)
		const closes = String.includes('-->')(line)
		return {
			comment: (state.comment || opens) && !closes,
			fence: state.fence !== fence,
			hidden: state.comment || state.fence || fence || opens || closes
		}
	})
	return pipe(
		Array.zip(lines, Array.drop(hidden, 1)),
		Array.map((pair, index) => ({hidden: pair[1].hidden, line: index + 1, text: pair[0]})),
		Array.filter(entry => !entry.hidden && String.isNonEmpty(entry.text) && !matches(SILENT)(entry.text)),
		Array.map(entry => ({proof, text: entry.text, where: where(entry.line)}))
	)
}

function prefixed(lines: string[], prefix: string) {
	return pipe(
		lines,
		Array.findFirst(line => String.startsWith(prefix)(line) && line !== `${prefix}/dev/null`),
		Option.map(String.slice(prefix.length))
	)
}

function pathOf(lines: string[]) {
	return pipe(
		prefixed(lines, '+++ b/'),
		Option.orElse(() => prefixed(lines, '--- a/')),
		Option.orElse(() => prefixed(lines, 'rename to ')),
		Option.orElse(() =>
			pipe(
				Array.head(lines),
				Option.flatMap(String.match(/ b\/(.+)$/u)),
				Option.flatMap(found => Array.get(found, 1))
			)
		),
		Option.getOrElse(() => '')
	)
}

// One hunk's lines: the changed ones on the side that still exists, numbered from the hunk's header.
function hunkOf(file: string, deleted: boolean, header: string, body: string[], status: string[]) {
	const numbers = pipe(
		String.match(HUNK_HEADER)(header),
		Option.map(found => Array.map([found[1], found[2]], value => Option.getOrElse(Number.parse(value ?? ''), () => 0))),
		Option.getOrElse(() => [0, 0])
	)
	const starts = {next: numbers[1] ?? 0, previous: numbers[0] ?? 0}
	const positions = Array.scan(
		body,
		{changed: Option.none<number>(), next: starts.next, previous: starts.previous},
		(at, line) => {
			if (String.startsWith('+')(line)) return {changed: Option.some(at.next), next: at.next + 1, previous: at.previous}
			if (String.startsWith('-')(line)) {
				return {
					changed: Option.some(Boolean.match(deleted, {onFalse: () => at.next, onTrue: () => at.previous})),
					next: at.next,
					previous: at.previous + 1
				}
			}
			return {changed: Option.none(), next: at.next + 1, previous: at.previous + 1}
		}
	)
	const changed = Array.getSomes(Array.map(positions, at => at.changed))
	const ignores = pipe(
		body,
		Array.filter(line => !String.startsWith('-')(line)),
		Array.flatMap(line => Option.toArray(String.match(/judge-ignore (\S+) -- \S/u)(line))),
		Array.flatMap(found => Option.toArray(Array.get(found, 1)))
	)
	return {
		changed,
		hunk: {
			end: Option.getOrElse(Array.last(changed), () => 0),
			file,
			ignores: HashSet.fromIterable(ignores),
			start: Option.getOrElse(Array.head(changed), () => 0),
			text: Array.join([...status, ...body], '\n')
		}
	}
}

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
		return {lines: pipe(lines, Array.drop(start), Array.take(end - start)), opening: lines[start] ?? ''}
	})
}

// Each file of a unified diff: its hunks, and the lines of the file as it is now that the change touched.
function filesOf(diff: string) {
	// One section per file; `between` leaves out anything before the first file's header.
	return Array.map(
		between(
			pipe(
				diff,
				String.split('\n'),
				Array.filter(line => line !== '\\ No newline at end of file')
			),
			String.startsWith('diff --git ')
		),
		section => {
			const file = pathOf(section.lines)
			const status = Array.filter(section.lines, matches(STATUS))
			const deleted = Array.some(status, String.startsWith('deleted file mode'))
			const hunks = Array.map(between(section.lines, String.startsWith('@@ ')), found =>
				hunkOf(file, deleted, found.opening, Array.drop(found.lines, 1), status)
			)
			return {
				deleted,
				file,
				hunks: Array.match(hunks, {
					onEmpty: () => [{end: 0, file, ignores: HashSet.empty<string>(), start: 0, text: Array.join(status, '\n')}],
					onNonEmpty: Array.map(found => found.hunk)
				}),
				touched: Array.flatMap(hunks, found => found.changed)
			}
		}
	)
}

const defaultBranch = Effect.fnUntraced(function* (root: string) {
	const result = yield* run('git', ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], root)
	if (result.exitCode !== 0) {
		return yield* JudgeError.make({
			message: 'No origin default branch; name the branch this change goes into with --base <ref>'
		})
	}
	return String.trim(result.stdout)
})

// What the change is: its request (a pull request's title and body, or the commit messages since the base), the hunks of its diff against the base and the claims the request makes.
export const change = Effect.fnUntraced(function* (base: Option.Option<string>, ignore: readonly string[]) {
	const root = String.trim(yield* git(['rev-parse', '--show-toplevel'], '.'))
	const pullRequest = yield* pipe(
		run('gh', ['pr', 'view', '--json', 'baseRefName,body,number,title'], root),
		Effect.flatMap(result => {
			// No pull request for this branch, or no host gh can reach: the commits say what the change does.
			if (result.exitCode !== 0) return Effect.succeedNone
			return Effect.asSome(Schema.decodeEffect(Schema.fromJsonString(PullRequest))(result.stdout))
		}),
		// No gh on this machine is the same: a repository without a pull request host.
		Effect.catchTag('PlatformError', () => Effect.succeedNone)
	)
	const baseRef = yield* pipe(
		base,
		Option.orElse(() => Option.map(pullRequest, found => `origin/${found.baseRefName}`)),
		Option.match({onNone: () => defaultBranch(root), onSome: Effect.succeed})
	)
	const mergeBase = String.trim(yield* git(['merge-base', baseRef, 'HEAD'], root))
	const pathspec = [':(top)', ...Array.map(ignore, glob => `:(top,exclude,glob)${glob}`)]
	const tracked = yield* git([...DIFF, '--no-relative', '--find-renames', mergeBase, '--', ...pathspec], root)
	const untracked = yield* Effect.forEach(
		pipe(
			yield* git(['ls-files', '--others', '--exclude-standard', '--', ...pathspec], root),
			String.split('\n'),
			Array.filter(String.isNonEmpty)
		),
		file => git([...DIFF, '--no-index', '--', '/dev/null', file], root),
		{concurrency: 16}
	)
	const files = filesOf(Array.join([tracked, ...untracked], '\n'))
	const commits = pipe(
		yield* git(['log', '--reverse', '--format=%h%x1f%B%x1e', `${mergeBase}..HEAD`], root),
		String.split('\u001e'),
		Array.map(String.trim),
		Array.filter(String.isNonEmpty),
		Array.map(entry => {
			const parts = String.split(entry, '\u001f')
			return {message: String.trim(parts[1] ?? ''), sha: Array.headNonEmpty(parts)}
		})
	)
	const request = Option.match(pullRequest, {
		onNone: () => ({
			claims: Array.flatMap(commits, commit =>
				claimsOf(commit.message, line => `commit ${commit.sha}:${line}`, commit.message)
			),
			source: `${commits.length} commits since ${baseRef}`,
			text: pipe(
				commits,
				Array.map(commit => commit.message),
				Array.join('\n\n')
			)
		}),
		onSome: found => {
			const text = `${found.title}\n\n${found.body}`
			return {
				claims: claimsOf(text, line => `pull request #${found.number}:${line}`, text),
				source: `pull request #${found.number} into ${baseRef}`,
				text
			}
		}
	})
	if (String.isEmpty(request.text) && Array.isArrayNonEmpty(files)) {
		return yield* JudgeError.make({
			message: `Nothing says what this change does: no pull request and no commits since ${baseRef}; commit it first`
		})
	}
	return {
		claims: request.claims,
		hunks: Array.flatMap(files, found => found.hunks),
		request: request.text,
		root,
		source: request.source,
		// The changed lines of each file that still exists, which pick the units the line-level questions read.
		touched: Record.fromEntries(
			Array.flatMap(files, found => {
				if (found.deleted) return []
				return [[found.file, found.touched] as const]
			})
		)
	}
})
