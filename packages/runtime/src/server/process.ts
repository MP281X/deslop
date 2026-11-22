import {createZstdDecompress} from 'node:zlib'

import {NodeStream} from '@effect/platform-node'

import {
	Array,
	ByteSize,
	Cache,
	Context,
	Effect,
	Exit,
	FileSystem,
	Function,
	Layer,
	Path,
	Schema,
	Stream,
	pipe
} from 'effect'
import type {Duration, PlatformError} from 'effect'

import {ChildProcess} from 'effect/process'

import {packageMetadata, packageRoot} from '#server/package.ts'
import {dataDirectory} from '#server/store.ts'

export class AppError extends Schema.TaggedError<AppError>()('AppError', {
	cause: Schema.optional(Schema.Defect()),
	exitCode: Schema.optional(Schema.Int),
	message: Schema.String
}) {}

// A command that never returns or floods its pipes is killed with its scope; a caller that expects a longer run names its own timeout.
export const executeProcess = Effect.fn('Process.execute')(function* (
	command: string,
	args: string[],
	options?: {readonly timeout?: Duration.Input}
) {
	yield* Effect.annotateCurrentSpan({command, 'command.arguments': args.length})
	const process = yield* ChildProcess.make(command, args, {stderr: 'pipe', stdout: 'pipe'})
	function text(stream: Stream.Stream<Uint8Array, PlatformError.PlatformError>, name: string) {
		return pipe(
			stream,
			Stream.limitBytes<PlatformError.PlatformError | AppError, never>(ByteSize.mebibytes(4), () =>
				Stream.fail(AppError.make({message: `${command} wrote more than 4 MiB of ${name}`}))
			),
			Stream.decodeText,
			Stream.mkString
		)
	}
	const result = yield* Effect.timeout(
		Effect.all(
			{code: process.exitCode, stderr: text(process.stderr, 'stderr'), stdout: text(process.stdout, 'stdout')},
			{concurrency: 'unbounded'}
		),
		options?.timeout ?? '30 seconds'
	)
	if (result.code !== 0) {
		return yield* AppError.make({exitCode: result.code, message: `${command} failed: ${result.stderr}`})
	}
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
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const paths = yield* Cache.makeWith(tool, {
				capacity: Infinity,
				requireServicesAt: 'lookup',
				timeToLive: Exit.match({onFailure: Function.constant(0), onSuccess: Function.constant('Infinity')})
			})
			return (name: string) => Cache.get(paths, name)
		})
	)
}
