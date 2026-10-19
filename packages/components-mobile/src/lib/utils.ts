import {Effect} from 'effect'

import {Atom} from 'effect/reactivity'
import {Asset} from 'expo-asset'
import {Directory, File, Paths} from 'expo-file-system'
import {Alert} from 'react-native'

export function alert(title: string) {
	return <A, E extends {message: string}, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.tapError(effect, error => Effect.sync(() => Alert.alert(title, error.message)))
}

// A killed app never leaves half a file behind.
export function writeAtomically(file: File, text: string) {
	const temporary = new File(`${file.uri}.tmp`)
	temporary.writeSync(text)
	temporary.moveSync(file, {overwrite: true})
}

// SwiftUI images read local files, and Metro names each bundled image by a module number.
export const assetAtom = Atom.family((module: number | string) =>
	Atom.make(
		Effect.map(
			Effect.promise(() => Asset.fromModule(module).downloadAsync()),
			asset => asset.localUri ?? asset.uri
		)
	)
)

const downloads = new Directory(Paths.cache, 'downloads')

// A remote file downloaded once into the cache under its name, for views that read local files.
export const downloadAtom = Atom.family((source: {name: string; url: string}) =>
	Atom.make(
		Effect.gen(function* () {
			const file = new File(downloads, source.name)
			if (file.exists) return file.uri
			downloads.create({idempotent: true, intermediates: true})
			return (yield* Effect.tryPromise(() => File.downloadFileAsync(source.url, file))).uri
		})
	)
)
