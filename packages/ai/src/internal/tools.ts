import {Array, Boolean, Effect, FileSystem, Number, Path, Predicate, Result, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/unstable/process'

import {PiToolkit} from '#schema'

class ToolExecutionError extends Schema.TaggedError<ToolExecutionError>()('ToolExecutionError', {
	message: Schema.String
}) {}

function boundedNatural(fallback: number, value?: number) {
	if (Predicate.isUndefined(value)) return fallback
	return Number.max(0, Number.round(value, 0))
}

function truncateOutput(value: string, maximum = 50_000) {
	if (String.length(value) <= maximum) return value
	return `[truncated ${String.length(value) - maximum} characters]\n${String.slice(String.length(value) - maximum)(value)}`
}

export const handlers = Effect.fnUntraced(function* (cwd: string) {
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

	return PiToolkit.of({
		bash: Effect.fnUntraced(function* ({command, timeout}) {
			const execute = Effect.scoped(
				Effect.gen(function* () {
					const process = yield* spawner.spawn(ChildProcess.make('sh', ['-lc', command], {cwd}))
					const [output, exitCode] = yield* Effect.all(
						[pipe(process.all, Stream.decodeText(), Stream.mkString), process.exitCode],
						{concurrency: 'unbounded'}
					)
					if (exitCode !== ChildProcessSpawner.ExitCode(0)) {
						return yield* ToolExecutionError.make({
							message: `command exited with ${exitCode}:\n${truncateOutput(output)}`
						})
					}
					return truncateOutput(output)
				})
			)
			if (Predicate.isUndefined(timeout)) return yield* execute
			return yield* Effect.timeout(execute, `${timeout} seconds`)
		}),
		edit: Effect.fnUntraced(function* ({edits, path: inputPath}) {
			const target = path.resolve(cwd, inputPath)
			const original = yield* fs.readFileString(target)
			const content = yield* Effect.reduce(
				edits,
				() => original,
				(current, replacement) => {
					const occurrences = String.split(replacement.oldText)(current)
					if (Array.length(occurrences) !== 2) {
						return Effect.fail(
							ToolExecutionError.make({
								message: `oldText must occur exactly once, found ${Array.length(occurrences) - 1}`
							})
						)
					}
					return Effect.succeed(`${occurrences[0]}${replacement.newText}${occurrences[1]}`)
				}
			)
			yield* fs.writeFileString(target, content)
			return `Edited ${inputPath}`
		}),
		find: Effect.fnUntraced(function* ({limit, path: inputPath, pattern}) {
			const root = path.resolve(cwd, inputPath ?? '.')
			return pipe(
				yield* fs.glob(pattern, {root}),
				Array.map(match => path.relative(root, path.resolve(root, match))),
				Array.sort(String.Order),
				Array.take(boundedNatural(1_000, limit)),
				Array.join('\n')
			)
		}),
		grep: Effect.fnUntraced(function* ({glob, ignoreCase, limit, literal, path: inputPath, pattern}) {
			const target = path.resolve(cwd, inputPath ?? '.')
			const info = yield* fs.stat(target)
			const files = yield* Boolean.match(info.type === 'File', {
				onFalse: () =>
					pipe(fs.glob(glob ?? '**/*', {root: target}), Effect.map(Array.map(file => path.resolve(target, file)))),
				onTrue: () => Effect.succeed([target])
			})
			const literalMatcher = Boolean.match(ignoreCase === true, {
				onFalse: () => String.includes(pattern),
				onTrue: () => (line: string) => String.includes(String.toLowerCase(pattern))(String.toLowerCase(line))
			})
			const matcher = Boolean.match(literal === true, {
				onFalse: () => {
					const flags = Boolean.match(ignoreCase === true, {onFalse: () => undefined, onTrue: () => 'i'})
					const expression = new RegExp(pattern, flags)
					return (line: string) => expression.test(line)
				},
				onTrue: () => literalMatcher
			})
			const groups = yield* Effect.forEach(
				files,
				file =>
					pipe(
						fs.readFileString(file),
						Effect.map(content =>
							pipe(
								String.split('\n')(content),
								Array.filterMap((line, index) =>
									Boolean.match(matcher(line), {
										onFalse: () => Result.failVoid,
										onTrue: () => Result.succeed(`${path.relative(target, file)}:${index + 1}:${line}`)
									})
								)
							)
						),
						Effect.orElseSucceed(() => Array.empty<string>())
					),
				{concurrency: 8}
			)
			return pipe(groups, Array.flatten, Array.take(boundedNatural(100, limit)), Array.join('\n'))
		}),
		ls: Effect.fnUntraced(function* ({limit, path: inputPath}) {
			const target = path.resolve(cwd, inputPath ?? '.')
			const names = pipe(
				yield* fs.readDirectory(target),
				Array.sort(String.Order),
				Array.take(boundedNatural(500, limit))
			)
			return pipe(
				yield* Effect.forEach(names, name =>
					pipe(
						fs.stat(path.join(target, name)),
						Effect.map(info =>
							Boolean.match(info.type === 'Directory', {onFalse: () => name, onTrue: () => `${name}/`})
						)
					)
				),
				Array.join('\n')
			)
		}),
		read: Effect.fnUntraced(function* ({limit, offset, path: inputPath}) {
			return pipe(
				String.split('\n')(yield* fs.readFileString(path.resolve(cwd, inputPath))),
				Array.drop(Number.max(0, boundedNatural(1, offset) - 1)),
				Array.take(boundedNatural(2_000, limit)),
				Array.join('\n'),
				truncateOutput
			)
		}),
		write: Effect.fnUntraced(function* ({content, path: inputPath}) {
			const target = path.resolve(cwd, inputPath)
			yield* fs.makeDirectory(path.dirname(target), {recursive: true})
			yield* fs.writeFileString(target, content)
			return `Wrote ${inputPath}`
		})
	})
})
