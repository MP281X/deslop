import {SqliteClient} from '@effect/sql-sqlite-node'

import {Config, Effect, FileSystem, Layer, Option, Path, Predicate, Semaphore, Struct, pipe} from 'effect'

import {KeyValueStore} from 'effect/persistence'
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

// fallow-ignore-next-line unused-export -- the data store opens it in production; the apps' tests open one per directory directly.
export function layerKeyValueStore(directory: string) {
	return pipe(
		Layer.effect(
			KeyValueStore.KeyValueStore,
			Effect.gen(function* () {
				const base = yield* KeyValueStore.KeyValueStore
				const fs = yield* FileSystem.FileSystem
				const path = yield* Path.Path
				const writes = yield* Semaphore.make(1)
				return KeyValueStore.make({
					...Struct.omit(base, ['set', 'modify', 'modifyUint8Array']),
					set: (key, value) => {
						if (key === '' || key === '.' || key === '..') {
							return Effect.fail(
								new KeyValueStore.KeyValueStoreError({key, message: 'Invalid storage key', method: 'set'})
							)
						}
						const target = path.join(directory, encodeURIComponent(key))
						return pipe(
							Effect.gen(function* () {
								if (Predicate.isString(value)) yield* fs.writeFileString(`${target}.tmp`, value, {mode: 0o600})
								else yield* fs.writeFile(`${target}.tmp`, value, {mode: 0o600})
							}),
							Effect.andThen(fs.rename(`${target}.tmp`, target)),
							Effect.uninterruptible,
							Semaphore.withPermit(writes),
							Effect.mapError(
								cause =>
									new KeyValueStore.KeyValueStoreError({cause, key, message: 'Cannot save the value', method: 'set'})
							)
						)
					}
				})
			})
		),
		Layer.provide(KeyValueStore.layerFileSystem(directory))
	)
}

// The app's key-value files and its one SQLite database sit together; the database and the services share one Reactivity, so a committed write reaches every live query.
export const layerDataStore = Layer.unwrap(
	Effect.gen(function* () {
		const directory = yield* dataDirectory
		return Layer.mergeAll(
			layerKeyValueStore(directory),
			SqliteClient.layer({filename: (yield* Path.Path).join(directory, 'data.sqlite')}),
			Reactivity.layer
		)
	})
)
