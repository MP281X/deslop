import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	ByteSize,
	Effect,
	FileSystem,
	HashMap,
	HashSet,
	Layer,
	Option,
	Path,
	Ref,
	Result,
	Stream,
	String,
	pipe
} from 'effect'

import {PiToolkit} from '#schema'

import {handlers} from './tools.ts'

function info(type: FileSystem.File.Type, size = 0): FileSystem.File.Info {
	return {
		atime: Option.none(),
		birthtime: Option.none(),
		blksize: Option.none(),
		blocks: Option.none(),
		dev: 0,
		gid: Option.none(),
		ino: Option.none(),
		mode: 0,
		mtime: Option.none(),
		nlink: Option.none(),
		rdev: Option.none(),
		size: ByteSize.bytes(size),
		type,
		uid: Option.none()
	}
}

const makeFileSystem = Effect.fnUntraced(function* () {
	const files = yield* Ref.make(HashMap.empty<string, string>())
	return FileSystem.makeNoop({
		glob: Effect.fnUntraced(function* (pattern, options) {
			return pipe(
				yield* Ref.get(files),
				HashMap.keys,
				Array.fromIterable,
				Array.filterMap(file => {
					const prefix = `${options?.root ?? '.'}/`
					if (!String.startsWith(prefix)(file)) return Result.failVoid
					if (pattern === '**/*.txt' && !String.endsWith('.txt')(file)) return Result.failVoid
					return Result.succeed(String.slice(String.length(prefix))(file))
				})
			)
		}),
		makeDirectory: () => Effect.void,
		readDirectory: Effect.fnUntraced(function* (directory) {
			return pipe(
				yield* Ref.get(files),
				HashMap.keys,
				Array.fromIterable,
				Array.filterMap(file => {
					const prefix = `${directory}/`
					if (!String.startsWith(prefix)(file)) return Result.failVoid
					return pipe(
						String.slice(String.length(prefix))(file),
						String.split('/'),
						Array.head,
						Result.fromOption(() => undefined)
					)
				}),
				HashSet.fromIterable,
				Array.fromIterable
			)
		}),
		readFileString: Effect.fnUntraced(function* (path) {
			return Option.getOrThrow(HashMap.get(yield* Ref.get(files), path))
		}),
		stat: Effect.fnUntraced(function* (path) {
			return pipe(
				HashMap.get(yield* Ref.get(files), path),
				Option.match({onNone: () => info('Directory'), onSome: content => info('File', String.length(content))})
			)
		}),
		writeFileString: Effect.fnUntraced(function* (path, content) {
			yield* Ref.update(files, HashMap.set(path, content))
		})
	})
})

it.layer(NodeServices.layer)('Pi tools', test => {
	test.effect(
		'execute the normalized filesystem and process tools',
		Effect.fnUntraced(function* () {
			const cwd = (yield* Path.Path).resolve('.')
			const fileSystem = yield* makeFileSystem()
			const handlerContext = yield* Layer.build(
				PiToolkit.toLayer(pipe(handlers(cwd), Effect.provideService(FileSystem.FileSystem, fileSystem)))
			)
			const toolkit = yield* pipe(PiToolkit, Effect.provide(handlerContext))

			yield* pipe(
				toolkit.handle('write', {content: 'first\nneedle', path: 'notes/a.txt'}),
				Effect.flatMap(Stream.runDrain),
				Effect.orDie
			)
			yield* pipe(
				toolkit.handle('edit', {
					edits: [
						{newText: 'draft', oldText: 'first'},
						{newText: 'second', oldText: 'draft'}
					],
					path: 'notes/a.txt'
				}),
				Effect.flatMap(Stream.runDrain),
				Effect.orDie
			)
			const failedEdit = yield* pipe(
				toolkit.handle('edit', {
					edits: [
						{newText: 'third', oldText: 'second'},
						{newText: 'third', oldText: 'missing'}
					],
					path: 'notes/a.txt'
				}),
				Effect.flatMap(Stream.runDrain),
				Effect.flip
			)

			const read = yield* pipe(
				toolkit.handle('read', {path: 'notes/a.txt'}),
				Effect.flatMap(Stream.runLast),
				Effect.map(Option.map(result => result.result)),
				Effect.orDie
			)
			const grep = yield* pipe(
				toolkit.handle('grep', {path: '.', pattern: 'needle'}),
				Effect.flatMap(Stream.runLast),
				Effect.map(Option.map(result => result.result)),
				Effect.orDie
			)
			const find = yield* pipe(
				toolkit.handle('find', {path: '.', pattern: '**/*.txt'}),
				Effect.flatMap(Stream.runLast),
				Effect.map(Option.map(result => result.result)),
				Effect.orDie
			)
			const ls = yield* pipe(
				toolkit.handle('ls', {path: '.'}),
				Effect.flatMap(Stream.runLast),
				Effect.map(Option.map(result => result.result)),
				Effect.orDie
			)
			const bash = yield* pipe(
				toolkit.handle('bash', {command: 'pwd'}),
				Effect.flatMap(Stream.runLast),
				Effect.map(Option.map(result => result.result)),
				Effect.orDie
			)

			assert.containsSubset(failedEdit, {_tag: 'ToolExecutionError'})
			assert.strictEqual(pipe(read, Option.getOrThrow), 'second\nneedle')
			assert.include(pipe(grep, Option.getOrThrow), 'notes/a.txt:2:needle')
			assert.strictEqual(pipe(find, Option.getOrThrow), 'notes/a.txt')
			assert.strictEqual(pipe(ls, Option.getOrThrow), 'notes/')
			assert.include(pipe(bash, Option.getOrThrow), cwd)
		})
	)
})
