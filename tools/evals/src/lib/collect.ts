// @effect-diagnostics-next-line nodeBuiltinImport:off -- T3 stores orchestration in Node's built-in SQLite format.
import {DatabaseSync} from 'node:sqlite'

import {
	Array,
	Boolean,
	DateTime,
	Effect,
	FileSystem,
	Option,
	Path,
	Predicate,
	Random,
	Record,
	Schema,
	String,
	pipe
} from 'effect'
import type {Cause, PlatformError} from 'effect'

import {EvalError, Manifest, NativeRecord} from '#schema'

import {Settings, command} from '#lib/prepare'
import {blindText, measure} from '#lib/utils'

type Thread = typeof Thread.Type
const Thread = Schema.Struct({
	completed_at: Schema.NullOr(Schema.String),
	native_id: Schema.NullOr(Schema.String),
	provider_instance_id: Schema.NullOr(Schema.String),
	requested_at: Schema.String,
	status: Schema.String
})
type Child = typeof Child.Type
const Child = Schema.Struct({child_thread_id: Schema.NullOr(Schema.String)})
type Provider = typeof Provider.Type
const Provider = Schema.Struct({
	config: Schema.optionalKey(Schema.Struct({homePath: Schema.optionalKey(Schema.String)})),
	driver: Schema.optionalKey(Schema.String)
})

export const recordRun = Effect.fn('Evals.recordRun')(function* (directory: string, id: string, threadId: string) {
	const fs = yield* FileSystem.FileSystem
	const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
		yield* fs.readFileString(`${directory}/manifest.json`)
	)
	if (!Array.some(manifest.runs, run => run.id === id)) return yield* EvalError.make({message: `Unknown run ${id}`})
	yield* fs.writeFileString(
		`${directory}/manifest.json`,
		yield* Schema.encodeEffect(Schema.fromJsonString(Manifest, {space: 2}))({
			...manifest,
			runs: Array.map(manifest.runs, run =>
				Boolean.match(run.id === id, {onFalse: () => run, onTrue: () => ({...run, threadId})})
			)
		})
	)
})

export const collect = Effect.fn('Evals.collect')(function* (directory: string, home: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const manifest = yield* Schema.decodeEffect(Schema.fromJsonString(Manifest))(
		yield* fs.readFileString(`${directory}/manifest.json`)
	)
	const database = yield* Effect.acquireRelease(
		Effect.try(() => new DatabaseSync(`${home}/.t3/userdata/statev2.sqlite`, {readOnly: true})),
		opened => Effect.sync(() => opened.close())
	)
	const settings = yield* Schema.decodeEffect(Schema.fromJsonString(Settings))(
		yield* fs.readFileString(`${home}/.t3/userdata/settings.json`)
	)
	const all = Effect.fnUntraced(function* (threadId: string) {
		const rows = yield* Effect.try(() =>
			database
				.prepare(`SELECT r.status, r.requested_at, r.completed_at,
			json_extract(p.payload_json, '$.nativeThreadRef.nativeId') AS native_id, p.provider_instance_id
			FROM orchestration_v2_projection_runs r LEFT JOIN orchestration_v2_projection_provider_threads p
			ON p.provider_thread_id = r.provider_thread_id WHERE r.thread_id = ? ORDER BY r.ordinal`)
				.all(threadId)
		)
		return yield* Schema.decodeUnknownEffect(Schema.Array(Thread))(rows)
	})
	const readTrace = Effect.fnUntraced(function* (file: string) {
		return yield* Effect.forEach(
			Array.filter(String.split(yield* fs.readFileString(file), '\n'), String.isNonEmpty),
			line => Schema.decodeEffect(Schema.fromJsonString(NativeRecord))(line)
		)
	})
	const traces = Effect.fnUntraced(function* (
		threadId: string,
		seen: string[]
	): Effect.fn.Return<
		{threadId: string; sessions: {state: Thread; records: NativeRecord[]; files: string[]}[]}[],
		PlatformError.PlatformError | Schema.SchemaError | Cause.UnknownError,
		FileSystem.FileSystem
	> {
		if (Array.contains(seen, threadId)) return []
		const sessions = yield* Effect.forEach(
			Array.dedupeWith(
				yield* all(threadId),
				(a, b) => a.native_id === b.native_id && a.provider_instance_id === b.provider_instance_id
			),
			session =>
				Effect.gen(function* () {
					const provider = yield* Schema.decodeEffect(Provider)(
						settings.providerInstances[session.provider_instance_id ?? ''] ?? {}
					)
					const nativeHome = Option.match(
						Array.findFirst(manifest.runs, run => run.instance === session.provider_instance_id),
						{
							onNone: () =>
								provider.config?.homePath ??
								path.join(
									home,
									Boolean.match(provider.driver === 'claudeAgent', {onFalse: () => '.codex', onTrue: () => '.claude'})
								),
							onSome: run => path.join(directory, 'homes', run.id)
						}
					)
					if (Predicate.isNull(session.native_id) || !(yield* fs.exists(nativeHome))) {
						return {files: Array.empty<string>(), records: Array.empty<NativeRecord>(), state: session}
					}
					const files = Array.map(yield* fs.glob(`**/*${session.native_id}*.jsonl`, {root: nativeHome}), file =>
						path.join(nativeHome, file)
					)
					return {files, records: Array.flatten(yield* Effect.forEach(files, readTrace)), state: session}
				})
		)
		const children = yield* Schema.decodeUnknownEffect(Schema.Array(Child))(
			yield* Effect.try(() =>
				database
					.prepare('SELECT child_thread_id FROM orchestration_v2_projection_subagents WHERE thread_id = ?')
					.all(threadId)
			)
		)
		const nested = yield* Effect.forEach(
			Array.flatMap(children, child => Option.toArray(Option.fromNullishOr(child.child_thread_id))),
			child => traces(child, [...seen, threadId])
		)
		return [{sessions, threadId}, ...Array.flatten(nested)]
	})
	const keyPath = `${directory}/judge-key.json`
	const key = yield* Boolean.match(yield* fs.exists(keyPath), {
		onFalse: () =>
			Effect.map(Random.shuffle(manifest.runs), runs =>
				Record.fromEntries(Array.map(runs, (run, index) => [`${index + 1}`, run.id]))
			),
		onTrue: () =>
			Effect.flatMap(
				fs.readFileString(keyPath),
				Schema.decodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String)))
			)
	})
	yield* fs.writeFileString(
		keyPath,
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Record(Schema.String, Schema.String), {space: 2}))(key)
	)
	const report = yield* Effect.forEach(manifest.runs, run =>
		Effect.gen(function* () {
			if (Predicate.isUndefined(run.threadId)) return {id: run.id, status: 'not-run'}
			const sessions = yield* all(run.threadId)
			const last = Option.getOrUndefined(Array.last(sessions))
			if (!last || !Array.contains(['completed', 'failed', 'cancelled', 'interrupted'], last.status)) {
				return yield* EvalError.make({message: `Wait for ${run.id} to reach a terminal state before collecting`})
			}
			if (last.provider_instance_id !== run.instance) {
				return yield* EvalError.make({message: `Wrong provider instance for ${run.id}`})
			}
			const threads = yield* traces(run.threadId, [])
			const metrics = Array.map(threads, thread => ({
				sessions: Array.map(thread.sessions, session => ({
					...session.state,
					...measure(session.records, Array.isReadonlyArrayNonEmpty(session.files)),
					transcriptAvailable: Array.isReadonlyArrayNonEmpty(session.files)
				})),
				threadId: thread.threadId
			}))
			const evidence = `${directory}/evidence/${run.id}`
			yield* fs.makeDirectory(`${evidence}/native`, {recursive: true})
			for (const thread of threads) {
				for (const file of Array.flatMap(thread.sessions, session => session.files)) {
					yield* fs.copyFile(
						file,
						path.join(
							evidence,
							'native',
							`${pipe(thread.threadId, String.replaceAll(':', '_'))}-${path.basename(file)}`
						)
					)
				}
			}
			const untracked = Array.filter(
				String.split(
					String.trim(yield* command(run.repo, 'git', ['ls-files', '--others', '--exclude-standard'])),
					'\n'
				),
				String.isNonEmpty
			)
			if (Array.isReadonlyArrayNonEmpty(untracked)) yield* command(run.repo, 'git', ['add', '-N', '--', ...untracked])
			const diff = yield* command(run.repo, 'git', [
				'diff',
				'--binary',
				run.seed,
				'--',
				'.',
				':!.claude',
				':!.codex',
				':!artifacts'
			])
			yield* command(run.repo, 'git', ['bundle', 'create', `${evidence}/repository.bundle`, '--all'])
			yield* fs.writeFileString(
				`${evidence}/branches.txt`,
				yield* command(run.repo, 'git', ['log', '--all', '--format=%H %D%n%B', `${run.seed}..`])
			)
			yield* fs.writeFileString(`${evidence}/diff.patch`, diff)
			yield* fs.writeFileString(
				`${evidence}/metrics.json`,
				yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(metrics)
			)
			const letter = Option.getOrThrow(Array.findFirst(Record.toEntries(key), entry => entry[1] === run.id))[0]
			const judge = `${directory}/judge/${letter}`
			yield* fs.makeDirectory(judge, {recursive: true})
			yield* command(run.repo, 'git', ['archive', `--output=${evidence}/seed.tar`, run.seed])
			yield* fs.makeDirectory(`${judge}/seed`, {recursive: true})
			yield* command(run.repo, 'tar', ['-xf', `${evidence}/seed.tar`, '-C', `${judge}/seed`])
			for (const name of ['.claude', '.codex']) yield* fs.remove(`${judge}/seed/${name}`, {recursive: true})
			if (!(yield* fs.exists(`${judge}/seed/node_modules`))) {
				yield* fs.symlink(yield* fs.realPath(path.join(run.repo, 'node_modules')), `${judge}/seed/node_modules`)
			}
			yield* fs.makeDirectory(`${judge}/branches`, {recursive: true})
			for (const branch of Array.filter(
				String.split(
					String.trim(yield* command(run.repo, 'git', ['for-each-ref', '--format=%(refname:short)', 'refs/heads'])),
					'\n'
				),
				String.isNonEmpty
			)) {
				const target = `${judge}/branches/${blindText(branch, directory)}.patch`
				yield* fs.makeDirectory(path.dirname(target), {recursive: true})
				yield* fs.writeFileString(
					target,
					blindText(
						yield* command(run.repo, 'git', [
							'diff',
							'--binary',
							run.seed,
							branch,
							'--',
							'.',
							':!.claude',
							':!.codex',
							':!artifacts'
						]),
						directory
					)
				)
			}
			yield* fs.writeFileString(
				`${judge}/branches/commits.txt`,
				blindText(yield* fs.readFileString(`${evidence}/branches.txt`), directory)
			)
			yield* fs.writeFileString(`${judge}/diff.patch`, blindText(diff, directory))
			if (yield* fs.exists(`${run.repo}/artifacts`)) {
				yield* fs.copy(`${run.repo}/artifacts`, `${evidence}/artifacts`)
			}
			const captures = pipe(
				metrics,
				Array.flatMap(metric => metric.sessions),
				Array.flatMap(session => session.trace),
				Array.flatMap(event =>
					Array.fromIterable(String.matchAll(/\/[^\s"'()\\]+\.(?:png|jpe?g|webp|mp4|webm)\b/gu)(event.text))
				),
				Array.map(match => match[0]),
				Array.filter(file => path.dirname(file) === path.join(home, '.t3/userdata/browser-artifacts')),
				Array.dedupe
			)
			for (const file of captures) {
				if (yield* fs.exists(file)) {
					yield* fs.makeDirectory(`${judge}/repo/artifacts`, {recursive: true})
					yield* fs.makeDirectory(`${evidence}/artifacts`, {recursive: true})
					yield* fs.copyFile(file, `${evidence}/artifacts/${path.basename(file)}`)
					yield* fs.copyFile(file, `${judge}/repo/artifacts/${path.basename(file)}`)
				}
			}
			yield* fs.writeFileString(
				`${judge}/reply.md`,
				pipe(
					blindText(Option.getOrUndefined(Array.last(metrics[0]?.sessions ?? []))?.reply ?? '', directory),
					text =>
						Array.reduce(captures, text, (reply, file) =>
							String.replaceAll(file, `repo/artifacts/${path.basename(file)}`)(reply)
						),
					String.replaceAll('EVAL/runs/RUN/repo/', 'repo/')
				)
			)
			for (const file of yield* fs.glob('**/*', {
				exclude: ['.git/**', '.claude/**', '.codex/**', 'node_modules/**', 'data/**'],
				root: run.repo
			})) {
				if ((yield* fs.stat(path.join(run.repo, file))).type !== 'Directory') {
					const target = path.join(judge, 'repo', blindText(file, directory))
					yield* fs.makeDirectory(path.dirname(target), {recursive: true})
					if (Option.isSome(String.match(/\.(?:md|txt|json|html|css|[cm]?[jt]sx?|toml|yaml|yml)$/u)(file))) {
						yield* fs.writeFileString(
							target,
							pipe(
								blindText(yield* fs.readFileString(path.join(run.repo, file)), directory),
								String.replaceAll('EVAL/runs/RUN/repo/', `${path.join(path.relative(path.dirname(file), '.'), '.')}/`)
							)
						)
					} else {
						yield* fs.copyFile(path.join(run.repo, file), target)
					}
				}
			}
			if (!(yield* fs.exists(`${judge}/repo/node_modules`))) {
				yield* fs.symlink(yield* fs.realPath(path.join(run.repo, 'node_modules')), `${judge}/repo/node_modules`)
			}
			yield* fs.copyFile(run.criteria, `${judge}/criteria.md`)
			const started = Option.getOrThrow(DateTime.make(sessions[0]?.requested_at ?? last.requested_at))
			return {
				elapsedMilliseconds: pipe(
					Option.fromNullishOr(last.completed_at),
					Option.flatMap(DateTime.make),
					Option.map(date => DateTime.toEpochMillis(date) - DateTime.toEpochMillis(started)),
					Option.getOrUndefined
				),
				id: run.id,
				judge: letter,
				status: last.status,
				threads: Array.map(metrics, metric => ({
					sessions: Array.map(metric.sessions, session => Record.remove(session, 'trace')),
					threadId: metric.threadId
				}))
			}
		})
	)
	yield* fs.writeFileString(
		`${directory}/report.json`,
		yield* Schema.encodeEffect(Schema.fromJsonString(Schema.Unknown))(report)
	)
	return report
})
