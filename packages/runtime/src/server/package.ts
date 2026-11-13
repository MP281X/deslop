import {cwd} from 'node:process'
import {fileURLToPath} from 'node:url'

import {Boolean, Effect, FileSystem, Path, Schema, String} from 'effect'

import {PackageMetadata} from '#shared/schema.ts'

// The bundle is `dist/server.js`, so its package sits one directory up, wherever npm installed it; unbundled, as in tests, it is the package being run.
export const packageRoot = Boolean.match(String.endsWith('.ts')(import.meta.url), {
	onFalse: () => fileURLToPath(new URL('..', import.meta.url)),
	onTrue: cwd
})

export const packageMetadata = Effect.gen(function* () {
	const file = (yield* Path.Path).join(packageRoot, 'package.json')
	return yield* Schema.decodeEffect(Schema.fromJsonString(PackageMetadata))(
		yield* (yield* FileSystem.FileSystem).readFileString(file)
	)
})

export const appName = Effect.map(packageMetadata, metadata => String.replace('@deslop/', '')(metadata.name))
