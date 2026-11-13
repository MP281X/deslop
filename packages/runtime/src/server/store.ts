import {SqliteClient} from '@effect/sql-sqlite-node'

import {Config, Effect, FileSystem, Layer, Option, Path} from 'effect'

import {Reactivity} from 'effect/reactivity'

import {appName, packageRoot} from '#server/package.ts'

// A checkout holds `pnpm-workspace.yaml` at its root; an npm installation has none above it.
const checkoutRoot = Effect.fnUntraced(function* (
	directory: string
): Effect.fn.Return<Option.Option<string>, never, FileSystem.FileSystem | Path.Path> {
	const path = yield* Path.Path
	if (
		yield* Effect.orElseSucceed(
			(yield* FileSystem.FileSystem).exists(path.join(directory, 'pnpm-workspace.yaml')),
			() => false
		)
	) {
		return Option.some(directory)
	}
	if (path.dirname(directory) === directory) return Option.none()
	return yield* checkoutRoot(path.dirname(directory))
})

export const dataDirectory = Effect.gen(function* () {
	const path = yield* Path.Path
	const name = yield* appName
	const directory = yield* Option.match(yield* checkoutRoot(packageRoot), {
		onNone: () => Effect.map(Config.String('HOME'), home => path.join(home, '.deslop', name)),
		onSome: root => Effect.succeed(path.join(root, '.deslop', name))
	})
	yield* (yield* FileSystem.FileSystem).makeDirectory(directory, {mode: 0o700, recursive: true})
	return directory
})

// The app's one SQLite database sits in `directory`, the data directory in production and a temporary one in tests; the database and the services share one Reactivity, so a committed write reaches every live query.
export function layerDataStore(directory: string) {
	return Layer.unwrap(
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const filename = (yield* Path.Path).join(directory, 'data.sqlite')
			// SQLite creates its file but not the folder around it, and gives its -wal and -shm files the database's own mode: it holds tokens and keys, so only the user reads it.
			yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
			yield* fs.writeFile(filename, new Uint8Array(), {flag: 'a', mode: 0o600})
			return Layer.merge(SqliteClient.layer({filename}), Reactivity.layer)
		})
	)
}
