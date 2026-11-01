import {Effect, FileSystem, Path, Schema} from 'effect'

import {AppManifest} from '#cli/schema.ts'

// npm/vp expose a bin symlink; argv[1] is not the real bundled entrypoint.
export const packageRoot = Effect.fnUntraced(function* (entry: string) {
	const path = yield* Path.Path
	return path.resolve(path.dirname(yield* (yield* FileSystem.FileSystem).realPath(entry)), '..')
})

export const packageVersion = Effect.fnUntraced(function* (entry: string) {
	return (yield* Schema.decodeEffect(Schema.fromJsonString(AppManifest))(
		yield* (yield* FileSystem.FileSystem).readFileString(
			(yield* Path.Path).join(yield* packageRoot(entry), 'package.json')
		)
	)).version
})
