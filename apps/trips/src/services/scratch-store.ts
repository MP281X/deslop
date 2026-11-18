// oxlint-disable-next-line effecttsgo/node-builtin-import -- Trips has no Node platform layer of its own; tests make and remove their scratch folder directly.
import {mkdtemp, rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'

import {ByteSize, Effect, FileSystem, Layer, Option, Path} from 'effect'

import {layerDataStore} from '@deslop/runtime/server/store'

// A folder of its own for one test, removed when the test ends; a store opened on it again finds what the last one wrote, as after a restart.
export const scratchFolder = Effect.acquireRelease(
	Effect.promise(() => mkdtemp(`${tmpdir()}/trips-`)),
	folder => Effect.promise(() => rm(folder, {force: true, recursive: true}))
)

// The runtime's own SQLite store in that folder. The store asks the file system only to make the folder, which exists, and to size the file, which SQLite then makes itself in its default journal mode.
export function scratchStore(folder: string) {
	return Layer.provide(
		layerDataStore(folder),
		Layer.merge(
			FileSystem.layerNoop({
				makeDirectory: () => Effect.void,
				stat: () =>
					Effect.succeed({
						atime: Option.none(),
						birthtime: Option.none(),
						blksize: Option.none(),
						blocks: Option.none(),
						dev: 0n,
						gid: Option.none(),
						ino: Option.none(),
						mode: 0o600,
						mtime: Option.none(),
						nlink: Option.none(),
						rdev: Option.none(),
						size: ByteSize.bytes(1),
						type: 'File',
						uid: Option.none()
					}),
				writeFile: () => Effect.void
			}),
			Path.layer
		)
	)
}
