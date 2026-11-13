import {Effect, Schema, String} from 'effect'

import {Atom} from 'effect/reactivity'
import {Asset} from 'expo-asset'
import {File, Paths} from 'expo-file-system'

import type {UserId} from '@deslop/runtime/shared/auth'

class DeviceError extends Schema.TaggedError<DeviceError>()('DeviceError', {
	cause: Schema.Defect(),
	message: Schema.String
}) {}

// SwiftUI images read local files, and Metro names each bundled image by a module number.
export const assetAtom = Atom.family((module: number | string) =>
	Atom.make(
		Effect.map(
			Effect.tryPromise({
				catch: cause => DeviceError.make({cause, message: `Image ${module} could not be loaded`}),
				try: () => Asset.fromModule(module).downloadAsync()
			}),
			asset => asset.localUri ?? asset.uri
		)
	)
)

// The account's GitHub picture, downloaded once, since SwiftUI images read local files.
export const avatarAtom = Atom.family((id: UserId) =>
	Atom.make(
		Effect.gen(function* () {
			const github = String.replace('github:', '')(id)
			const file = new File(Paths.cache, `avatar-${github}.png`)
			if (file.exists) return file.uri
			const downloaded = yield* Effect.tryPromise({
				catch: cause => DeviceError.make({cause, message: 'The account picture could not be downloaded'}),
				try: () => File.downloadFileAsync(`https://avatars.githubusercontent.com/u/${github}?s=96`, file)
			})
			return downloaded.uri
		})
	)
)
