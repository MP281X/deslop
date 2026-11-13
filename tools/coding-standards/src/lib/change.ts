import {Array, Boolean, Effect, FileSystem, HashSet, Number, Option, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {matches} from '#lib/ast.ts'
import {JudgeError} from '#lib/session.ts'
import {around} from '#lib/units.ts'

// The diff's every setting written out, so a machine's git configuration changes neither the change nor the answers keyed by it; full blob ids tell two binary changes apart.
const DIFF = [
	'diff',
	'--no-color',
	'--no-ext-diff',
	'--histogram',
	'--src-prefix=a/',
	'--dst-prefix=b/',
	'-U3',
	'--full-index',
	'--find-renames',
	'--text',
	'--no-textconv'
]
// The paths of a kind the judge reads, by extension or name: code, configuration, documents and data in text.
const READABLE =
	/(?:\.(?:[cm]?[jt]sx?|json[c5]?|ya?ml|toml|ini|conf|env|md|mdx|txt|sql|css|scss|html?|svg|xml|graphql|gql|sh|bash|zsh|fish|py|rb|go|rs|swift|kt|kts|java|c|h|cc|cpp|hpp|cs|php|vue|svelte|astro|prisma|lock|plist|entitlements|pbxproj|xcconfig|storyboard|strings|csv|tsv|patch|diff)|(?:^|\/)(?:Dockerfile|Makefile|Procfile|\.gitattributes|\.gitignore|\.editorconfig|\.npmrc|\.nvmrc|\.node-version|AGENTS|README|LICENSE)[^/]*)$/iu
const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/u
// Lines of a request that state nothing: headings, table rules, a recording or image alone on its line, and HTML that only wraps.
const SILENT =
	/^(?:#|\|[\s|:-]+\||!\[[^\]]*\]\([^)]*\)$|<\/?(?:details|summary|video|img|picture|source|p|br)\b|https?:\/\/\S+$|-\s*\[[ x]\]\s*$)/iu
// Evidence the judge cannot read, a recording or a still, by its address: a Markdown image, a `src` of video or image HTML, or a link to an attachment or a media file.
const MEDIA =
	/!\[[^\]]*\]\(([^)\s]+)[^)]*\)|<(?:video|img|source)\b[^>]*?\bsrc=["']([^"']+)["']|(https?:\/\/github\.com\/user-attachments\/[^\s)"'<>]+|https?:\/\/[^\s)"'<>]+\.(?:mp4|mov|webm|gif|png|jpe?g|webp)\b)/giu
// A heading or label that opens the request's admissions: what the change says it does not show working.
const NOT_PROVEN = /^(?:#+\s*|\*\*|[-*]\s+)?not proven\b/iu
// The numbered marks a picture gives each changed thing, ① to ⑳.
const MARKS = /[①-⑳]/gu
// A Mermaid node, `id`, `id[label]`, `id["label"]` or another shape, with an optional `:::class`; and the edge after it, with its words if it has any.
const NODE =
	/^\s*([A-Za-z_][\w-]*)\s*(?:(\[\[|\[\(|\(\(|\[|\(|\{\{|\{|>)\s*("[^"]*"|[^\])}"]*)\s*(?:\]\]|\)\]|\)\)|\]|\)|\}\}|\}))?(?::::[\w-]+)?\s*/u
const EDGE =
	/^(?:--\s*"([^"]*)"\s*-{2,}>?|--\s*([^"\s-][^-]*?)\s*-{2,}>?|(?:-{2,}>?|={2,}>?|-\.+->?|~~~)(?:\s*\|([^|]*)\|)?)\s*/u
// The language's own words, which a request quotes without naming anything the change or its callers define.
const LANGUAGE = [
	'any',
	'async',
	'await',
	'bigint',
	'boolean',
	'class',
	'const',
	'false',
	'function',
	'never',
	'null',
	'number',
	'object',
	'return',
	'string',
	'symbol',
	'this',
	'true',
	'type',
	'typeof',
	'undefined',
	'unknown',
	'void'
]
// Generated lockfiles, left out by default: the change to the manifest that produces one stays judged.
const LOCKFILES = [
	'**/Cargo.lock',
	'**/Gemfile.lock',
	'**/Package.resolved',
	'**/Podfile.lock',
	'**/bun.lock',
	'**/bun.lockb',
	'**/composer.lock',
	'**/deno.lock',
	'**/flake.lock',
	'**/go.sum',
	'**/mix.lock',
	'**/npm-shrinkwrap.json',
	'**/package-lock.json',
	'**/pnpm-lock.yaml',
	'**/poetry.lock',
	'**/pubspec.lock',
	'**/uv.lock',
	'**/yarn.lock'
]

// One line of what the change says it does.
export type Claim = {line: number; text: string; where: string}

// What the judge could not read though it is there to read it, and why.
export type Unreadable = {reason: string; where: string}

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

// Paths are read raw: git quotes none it prints, and the lists it prints end each path with a NUL.
const git = Effect.fnUntraced(function* (args: string[], cwd: string, failsWith: number[] = []) {
	const result = yield* run('git', ['-c', 'core.quotePath=false', ...args], cwd)
	if (result.exitCode !== 0 && !Array.contains(failsWith, result.exitCode)) {
		return yield* JudgeError.make({message: `git ${Array.join(args, ' ')} failed`})
	}
	return result.stdout
})

function fields(output: string) {
	return pipe(output, String.split('\u0000'), Array.filter(String.isNonEmpty))
}

// The circled marks a line names.
function marksOf(text: string) {
	return Array.map(Array.fromIterable(String.matchAll(MARKS)(text)), found => found[0])
}

// A Mermaid label as words: quotes dropped and each `<br/>` a line of its own.
function labelLines(label: string) {
	return pipe(
		label,
		String.replaceAll(/^"|"$/gu, ''),
		String.split(/<br\s*\/?>/u),
		Array.map(String.trim),
		Array.filter(String.isNonEmpty)
	)
}

// One line of a lane: nodes joined by edges, each edge with its words.
function chainOf(line: string): Option.Option<{edges: string[]; nodes: {id: string; label: string}[]}> {
	return Option.flatMap(String.match(NODE)(line), node => {
		const head = {id: node[1] ?? '', label: node[3] ?? ''}
		const rest = String.slice(node[0].length)(line)
		if (String.isEmpty(rest)) return Option.some({edges: [], nodes: [head]})
		return Option.flatMap(String.match(EDGE)(rest), edge =>
			Option.map(chainOf(String.slice(edge[0].length)(rest)), tail => ({
				edges: [edge[1] ?? edge[2] ?? edge[3] ?? '', ...tail.edges],
				nodes: [head, ...tail.nodes]
			}))
		)
	})
}

// The promises of a picture's After lane, which opens at `lane`: each labelled edge, each numbered line of a node and each other node no labelled edge names; a mark the lane's title says is not shown working is admitted, not claimed.
function laneClaims(input: {
	admitted: string[]
	block: string[]
	lane: number
	opening: number
	where: (line: number) => string
}) {
	const skipped = HashSet.fromIterable([
		...input.admitted,
		...pipe(
			Array.get(input.block, input.lane),
			Option.flatMap(String.match(/After[^"\]]*?·\s*([^"\]]*)not shown working/u)),
			Option.map(found => marksOf(found[1] ?? '')),
			Option.getOrElse(() => Array.empty<string>())
		)
	])
	const read = pipe(
		Array.drop(input.block, input.lane + 1),
		Array.map((text, index) => ({line: input.opening + input.lane + 2 + index, text: String.trim(text)})),
		Array.takeWhile(entry => !matches(/^end\b/u)(entry.text)),
		Array.filter(
			entry => String.isNonEmpty(entry.text) && !matches(/^(?:direction|class|classDef|style|%%)\b/u)(entry.text)
		),
		Array.map(entry => ({...entry, chain: chainOf(entry.text)}))
	)
	const broken = Array.filter(read, entry => Option.isNone(entry.chain))
	if (Array.isArrayNonEmpty(broken)) {
		return {
			claims: Array.empty<Claim>(),
			unreadable: Array.map(broken, entry => ({
				reason: 'a line of the picture’s After lane the judge cannot read as nodes and edges',
				where: input.where(entry.line)
			}))
		}
	}
	const labels = Record.fromEntries(
		Array.flatMap(read, entry =>
			pipe(
				Option.toArray(entry.chain),
				Array.flatMap(chain => chain.nodes),
				Array.filter(node => String.isNonEmpty(node.label)),
				Array.map(node => [node.id, labelLines(node.label)] as const)
			)
		)
	)
	function subjectOf(id: string) {
		return pipe(
			Record.get(labels, id),
			Option.getOrElse(() => [id]),
			Array.filter(line => Array.isArrayEmpty(marksOf(line))),
			Array.join(' ')
		)
	}
	function claimed(text: string) {
		const marks = marksOf(text)
		return !(Array.isArrayNonEmpty(marks) && Array.every(marks, mark => HashSet.has(skipped, mark)))
	}
	const claims = Array.flatMap(read, entry =>
		Array.flatMap(Option.toArray(entry.chain), chain => {
			const linked = Array.flatMap(chain.edges, (label, index) => {
				if (String.isEmpty(String.trim(label))) return []
				return [
					`${subjectOf(chain.nodes[index]?.id ?? '')} — ${Array.join(labelLines(label), ' ')} — ${subjectOf(chain.nodes[index + 1]?.id ?? '')}`
				]
			})
			const ends = HashSet.fromIterable(
				Array.flatMap(chain.edges, (label, index) => {
					if (String.isEmpty(String.trim(label))) return []
					return [chain.nodes[index]?.id ?? '', chain.nodes[index + 1]?.id ?? '']
				})
			)
			const parts = Array.flatMap(chain.nodes, node => {
				const lines = labelLines(node.label)
				const numbered = Array.filter(lines, line => Array.isArrayNonEmpty(marksOf(line)))
				if (Array.isArrayNonEmpty(numbered)) return Array.map(numbered, line => `${subjectOf(node.id)}: ${line}`)
				if (Array.isArrayEmpty(lines) || HashSet.has(ends, node.id)) return []
				return [Array.join(lines, ' ')]
			})
			return pipe(
				[...linked, ...parts],
				Array.filter(claimed),
				Array.map(text => ({line: entry.line, text, where: input.where(entry.line)}))
			)
		})
	)
	return {claims, unreadable: Array.empty<Unreadable>()}
}

// A picture with no After lane promises nothing the judge can read.
function pictureClaims(block: string[], opening: number, where: (line: number) => string, admitted: string[]) {
	return pipe(
		block,
		Array.findFirstIndex(matches(/^\s*subgraph\s+After\b/u)),
		Option.match({
			onNone: () => ({
				claims: Array.empty<Claim>(),
				unreadable: [{reason: 'a Mermaid block with no After lane', where: where(opening)}]
			}),
			onSome: lane => laneClaims({admitted, block, lane, opening, where})
		})
	)
}

// The lines of a request it promises: prose outside code fences, HTML comments and its not-proven admissions, and the After lane of each Mermaid picture.
export function claimsOf(text: string, where: (line: number) => string) {
	const lines = pipe(text, String.split('\n'), Array.map(String.trim))
	// Each line's place: inside a fence (and which), inside a comment, or under the admissions.
	const places = pipe(
		lines,
		Array.map((line, index) => ({index, line})),
		Array.scan(
			{admitted: false, comment: false, fence: Option.none<number>(), hidden: false, mermaid: false},
			(state, entry) => {
				const fence = String.startsWith('```')(entry.line)
				const opens = String.includes('<!--')(entry.line)
				const closes = String.includes('-->')(entry.line)
				const opening = Option.isNone(state.fence) && fence
				const hidden = state.comment || Option.isSome(state.fence) || fence || opens || closes
				// Only what the body renders opens or ends the admissions: a not-proven heading or label opens them, the next heading or alert ends them.
				const admits = !hidden && matches(NOT_PROVEN)(entry.line)
				const ends = !hidden && matches(/^(?:#|>\s*\[!)/u)(entry.line)
				return {
					admitted: (state.admitted && !ends) || admits,
					comment: (state.comment || opens) && !closes,
					fence: Option.match(state.fence, {
						onNone: () => Option.liftPredicate(entry.index, () => opening),
						onSome: start => Option.liftPredicate(start, () => !fence)
					}),
					hidden,
					mermaid:
						(opening && matches(/^```\s*mermaid\b/u)(entry.line)) ||
						(state.mermaid && !(Option.isSome(state.fence) && fence))
				}
			}
		)
	)
	const placed = pipe(
		lines,
		Array.zip(Array.drop(places, 1)),
		Array.map((pair, index) => ({...pair[1], line: index + 1, text: pair[0]}))
	)
	// Each recording or still the body renders, by its line: none inside a comment or a fence, which a reader never sees.
	const attachments = pipe(
		placed,
		Array.filter(entry => !entry.hidden),
		Array.flatMap(entry =>
			Array.map(Array.fromIterable(String.matchAll(MEDIA)(entry.text)), found => ({
				line: entry.line,
				ref: found[1] ?? found[2] ?? found[3] ?? found[0]
			}))
		)
	)
	const admitted = pipe(
		placed,
		Array.filter(entry => entry.admitted && !entry.hidden),
		Array.flatMap(entry => marksOf(entry.text))
	)
	const prose = pipe(
		placed,
		Array.filter(
			entry => !entry.hidden && !entry.admitted && String.isNonEmpty(entry.text) && !matches(SILENT)(entry.text)
		),
		Array.map(entry => ({line: entry.line, text: entry.text, where: where(entry.line)}))
	)
	// Each picture, found by its opening fence so an empty one is read too: the lines up to its closing fence.
	const pictures = pipe(
		placed,
		Array.filter(entry => entry.mermaid && Option.isSome(entry.fence)),
		Array.groupBy(entry => `${Option.getOrElse(entry.fence, () => 0)}`),
		Record.toEntries,
		Array.map(entry =>
			pictureClaims(
				pipe(
					entry[1],
					Array.drop(1),
					Array.map(line => line.text)
				),
				Option.getOrElse(Number.parse(entry[0]), () => 0) + 1,
				where,
				admitted
			)
		)
	)
	return {
		attachments,
		claims: [...prose, ...Array.flatMap(pictures, picture => picture.claims)],
		unreadable: Array.flatMap(pictures, picture => picture.unreadable)
	}
}

// The changed lines of a hunk on the side that still exists, numbered from its header.
function changedLines(header: string, body: string[], deleted: boolean) {
	const numbers = pipe(
		String.match(HUNK_HEADER)(header),
		Option.map(found => Array.map([found[1], found[2]], value => Option.getOrElse(Number.parse(value ?? ''), () => 0))),
		Option.getOrElse(() => [0, 0])
	)
	const positions = Array.scan(
		body,
		{changed: Option.none<number>(), next: numbers[1] ?? 0, previous: numbers[0] ?? 0},
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
	return Array.getSomes(Array.map(positions, at => at.changed))
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
		return pipe(lines, Array.drop(start), Array.take(end - start))
	})
}

// A changed file: its path now and at the base, how it changed, and its section of the diff.
type Entry = {before: Option.Option<string>; path: string; status: string}

// `git diff --name-status -z`: a status, then one path, or the old and new paths of a rename or copy.
function entriesOf(output: string) {
	const parts = fields(output)
	function from(index: number): Entry[] {
		const status = parts[index]
		if (status === undefined) return []
		if (matches(/^[RC]/u)(status)) {
			return [
				{
					before: Option.fromNullishOr(parts[index + 1]),
					path: parts[index + 2] ?? '',
					status: String.slice(0, 1)(status)
				},
				...from(index + 3)
			]
		}
		const path = parts[index + 1] ?? ''
		return [{before: Option.liftPredicate(path, () => status !== 'A'), path, status}, ...from(index + 2)]
	}
	return from(0)
}

// One file of the change: its section of the diff as Jev reads it, and the lines of the file as it is now that the change touched.
function fileOf(entry: Entry, section: string[]) {
	// The file's header, before its first hunk: its mode, blob ids, rename or binary note, without the paths Jev reads above it.
	const header = pipe(
		Array.drop(section, 1),
		Array.takeWhile(line => !String.startsWith('@@ ')(line)),
		Array.filter(line => !matches(/^(?:---|\+\+\+) /u)(line))
	)
	const hunks = between(section, String.startsWith('@@ '))
	// The diff is read as text whatever the change's attributes say; content holding a NUL byte is not text, and its blob ids alone stand for it.
	const text = !Array.some(Array.flatten(hunks), String.includes('\u0000'))
	return {
		...entry,
		binary: !text && !matches(READABLE)(entry.path),
		garbled: !text && matches(READABLE)(entry.path),
		text: Array.join(
			[`=== ${entry.path}`, ...header, ...Boolean.match(text, {onFalse: () => [], onTrue: () => Array.flatten(hunks)})],
			'\n'
		),
		touched: Array.flatMap(hunks, hunk => changedLines(hunk[0] ?? '', Array.drop(hunk, 1), entry.status === 'D'))
	}
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

// The changed paths a pathspec names, tracked or not.
const changedPaths = Effect.fnUntraced(function* (root: string, mergeBase: string, pathspec: string[]) {
	const tracked = yield* git([...DIFF, '--name-only', '-z', '--no-relative', mergeBase, '--', ...pathspec], root)
	const untracked = yield* git(['ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspec], root)
	return [...fields(tracked), ...fields(untracked)]
})

// The identifiers a request names in backticks, and the names the change declares that it mentions.
function namesOf(request: string, declared: string[]) {
	return Array.dedupe([
		...pipe(
			Array.fromIterable(String.matchAll(/`([A-Za-z_$][\w$]*)`/gu)(request)),
			Array.map(found => found[1] ?? ''),
			Array.filter(name => name.length >= 3 && !Array.contains(LANGUAGE, name))
		),
		...Array.filter(declared, name => matches(new RegExp(`\\b${name}\\b`, 'u'))(request))
	])
}

// Where each name the request names is declared and used outside the lines the change touched: the contracts and callers that tell a whole change from half of one.
const contextOf = Effect.fnUntraced(function* (
	root: string,
	names: string[],
	pathspec: string[],
	files: readonly {path: string; touched: number[]}[]
) {
	const fs = yield* FileSystem.FileSystem
	const touched = Record.fromEntries(Array.map(files, file => [file.path, HashSet.fromIterable(file.touched)] as const))
	const sections = yield* Effect.forEach(
		names,
		Effect.fnUntraced(function* (name) {
			const found = pipe(
				String.split(
					yield* git(['grep', '-n', '-I', '-z', '-w', '-F', '-e', name, '--', ...pathspec], root, [1]),
					'\n'
				),
				Array.flatMap(line => {
					const parts = String.split(line, '\u0000')
					const path = parts[0]
					const number = Option.getOrElse(Number.parse(parts[1] ?? ''), () => 0)
					if (parts.length < 3 || pipe(touched, Record.get(path), Option.exists(HashSet.has(number)))) return []
					return [{line: number, path, text: pipe(parts, Array.drop(2), Array.join(''), String.trim)}]
				}),
				Array.groupBy(entry => entry.path),
				Record.toEntries
			)
			// A code file shows each use as the whole statement or call that holds it, so a caller's arguments come with its name; any other file shows the line.
			const shown = yield* Effect.forEach(
				found,
				Effect.fnUntraced(function* (file) {
					const path = file[0]
					if (!matches(/\.[cm]?[jt]sx?$/u)(path)) {
						return Array.map(file[1], entry => `${path}:${entry.line}: ${entry.text}`)
					}
					return Array.map(
						around(
							path,
							yield* fs.readFileString(`${root}/${path}`),
							name,
							Array.map(file[1], entry => entry.line)
						),
						span =>
							Boolean.match(span.start === span.end, {
								onFalse: () => `${path}:${span.start}-${span.end}:\n${span.text}`,
								onTrue: () => `${path}:${span.start}: ${String.trim(span.text)}`
							})
					)
				}),
				{concurrency: 8}
			)
			return Array.match(Array.flatten(shown), {
				onEmpty: () => '',
				onNonEmpty: lines => Array.join([`\`${name}\`, outside the change:`, ...lines], '\n')
			})
		}),
		{concurrency: 8}
	)
	return pipe(sections, Array.filter(String.isNonEmpty), Array.join('\n\n'))
})

// What the change is: its request (a pull request's title and body, or the commit messages since the base), its whole diff against the base, what the request names around it, and what the judge leaves out.
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
	const left = [
		...Array.map(LOCKFILES, glob => ({glob, why: 'a generated lockfile'})),
		...Array.map(ignore, glob => ({glob, why: `--ignore ${glob}`}))
	]
	const pathspec = [':(top)', ...Array.map(left, entry => `:(top,exclude,glob)${entry.glob}`)]
	// Each changed path a default or an `--ignore` leaves out, with the first reason that names it.
	const excluded = pipe(
		yield* Effect.forEach(
			left,
			entry =>
				Effect.map(changedPaths(root, mergeBase, [`:(top,glob)${entry.glob}`]), paths =>
					Array.map(paths, path => ({path, why: entry.why}))
				),
			{concurrency: 8}
		),
		Array.flatten,
		Array.dedupeWith((first, second) => first.path === second.path)
	)
	const tracked = entriesOf(
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
	const added = yield* Effect.forEach(
		fields(yield* git(['ls-files', '-z', '--others', '--exclude-standard', '--', ...pathspec], root)),
		path =>
			Effect.map(git([...DIFF, '--no-index', '--', '/dev/null', path], root, [1]), output =>
				fileOf({before: Option.none(), path, status: 'A'}, String.split(output, '\n'))
			),
		{concurrency: 16}
	)
	const files = [
		...pipe(
			tracked,
			Array.zip(sections),
			Array.map(pair => fileOf(pair[0], pair[1]))
		),
		...added
	]
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
		onNone: () => {
			// Each commit's lines are placed in that commit.
			const offsets = Array.scan(commits, 0, (offset, commit) => offset + String.split(commit.message, '\n').length + 1)
			return {
				source: `${commits.length} commits since ${baseRef}`,
				text: pipe(
					commits,
					Array.map(commit => commit.message),
					Array.join('\n\n')
				),
				where: (line: number) => {
					const index = pipe(
						offsets,
						Array.findLastIndex(offset => offset < line),
						Option.getOrElse(() => 0)
					)
					return `commit ${commits[index]?.sha ?? ''}:${line - (offsets[index] ?? 0)}`
				}
			}
		},
		onSome: found => ({
			source: `pull request #${found.number} into ${baseRef}`,
			text: `${found.title}\n\n${found.body}`,
			where: (line: number) => `pull request #${found.number}:${line}`
		})
	})
	if (String.isEmpty(request.text) && Array.isArrayNonEmpty(files)) {
		return yield* JudgeError.make({
			message: `Nothing says what this change does: no pull request and no commits since ${baseRef}; commit it first`
		})
	}
	// The names the change declares, on the lines it adds or removes.
	const declared = pipe(
		files,
		Array.flatMap(file => String.split(file.text, '\n')),
		Array.filter(matches(/^[+-]/u)),
		Array.flatMap(line =>
			Option.toArray(
				String.match(
					/^[+-]\s*export\s+(?:default\s+)?(?:async\s+)?(?:const|let|function\*?|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/u
				)(line)
			)
		),
		Array.map(found => found[1] ?? '')
	)
	const claimed = claimsOf(request.text, request.where)
	return {
		attachments: claimed.attachments,
		claims: claimed.claims,
		context: yield* contextOf(root, namesOf(request.text, declared), pathspec, files),
		// A binary file at a path of no kind the judge reads is listed in the change with its blob ids, so two of them never share an answer, and left out of what is read like a lockfile.
		excluded: [
			...excluded,
			...pipe(
				files,
				Array.filter(file => file.binary),
				Array.map(file => ({path: file.path, why: 'binary'}))
			)
		],
		files,
		mergeBase,
		request: request.text,
		root,
		source: request.source,
		// A file of a kind the judge reads whose content is not text cannot be vouched for.
		unreadable: [
			...claimed.unreadable,
			...pipe(
				files,
				Array.filter(file => file.garbled),
				Array.map(file => ({reason: 'a file of a kind the judge reads, whose content is not text', where: file.path}))
			)
		]
	}
})

// A file's text at the base of the change.
export const sourceAt = Effect.fnUntraced(function* (root: string, mergeBase: string, path: string) {
	return yield* git(['show', `${mergeBase}:${path}`], root)
})
