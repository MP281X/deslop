import {createZstdDecompress} from 'node:zlib'

import {NodeStream} from '@effect/platform-node'

import {Array, Context, Effect, FileSystem, Layer, Path, Schema, Stream, pipe} from 'effect'

import {ChildProcess} from 'effect/process'

import {packageMetadata, packageRoot} from '#server/package.ts'
import {dataDirectory} from '#server/store.ts'

export class AppError extends Schema.TaggedError<AppError>()('AppError', {
	cause: Schema.optional(Schema.Defect()),
	message: Schema.String
}) {}

export const executeProcess = Effect.fn('Process.execute')(function* (command: string, args: string[]) {
	yield* Effect.annotateCurrentSpan({command, 'command.arguments': args.length})
	const process = yield* ChildProcess.make(command, args, {stderr: 'pipe', stdout: 'pipe'})
	const result = yield* Effect.all(
		{
			code: process.exitCode,
			stderr: Stream.mkString(Stream.decodeText(process.stderr)),
			stdout: Stream.mkString(Stream.decodeText(process.stdout))
		},
		{concurrency: 'unbounded'}
	)
	if (result.code !== 0) return yield* AppError.make({message: `${command} failed: ${result.stderr}`})
	return result.stdout
}, Effect.scoped)

// The app's native tools ship zstd-compressed in its `bin/`; the first use of a release unpacks one into the data directory.
const tool = Effect.fn('ToolPath.resolve')(function* (name: string) {
	yield* Effect.annotateCurrentSpan('tool', name)
	const fs = yield* FileSystem.FileSystem
	const path = yield* Path.Path
	const version = (yield* packageMetadata).version
	const tools = path.join(yield* dataDirectory, 'tools')
	const target = path.join(tools, version, name)
	if (yield* fs.exists(target)) return target
	yield* fs.makeDirectory(path.dirname(target), {recursive: true})
	yield* Effect.scoped(
		Effect.gen(function* () {
			const temporary = path.join(yield* fs.makeTempDirectoryScoped({directory: path.dirname(target)}), name)
			yield* pipe(
				fs.stream(path.join(packageRoot, 'bin', `${name}.zst`)),
				NodeStream.pipeThroughSimple(() => createZstdDecompress()),
				Stream.run(fs.sink(temporary))
			)
			yield* fs.chmod(temporary, 0o755)
			yield* fs.rename(temporary, target)
		})
	)
	yield* pipe(
		yield* fs.readDirectory(tools),
		Array.filter(entry => entry !== version),
		Effect.forEach(entry => fs.remove(path.join(tools, entry), {recursive: true}), {concurrency: 1})
	)
	return target
})

export class ToolPath extends Context.Service<ToolPath, typeof tool>()('@deslop/runtime/server/process/ToolPath') {
	static readonly layer = Layer.succeed(this, tool)
}
