import {Effect, Option} from 'effect'

import {Atom} from 'effect/reactivity'
import {Asset} from 'expo-asset'
import {File, Paths} from 'expo-file-system'

import type {UserId} from '@deslop/runtime/shared/auth'
import {avatarUrlOf} from '@deslop/runtime/shared/auth'

import {DeviceError} from '#lib/errors.ts'

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
		Option.match(avatarUrlOf(id), {
			onNone: () => Effect.succeed(Option.none<string>()),
			onSome: Effect.fnUntraced(function* (url: string) {
				const file = new File(Paths.cache, `avatar-${id}.png`)
				if (file.exists) return Option.some(file.uri)
				const downloaded = yield* Effect.tryPromise({
					catch: cause => DeviceError.make({cause, message: 'The account picture could not be downloaded'}),
					try: () => File.downloadFileAsync(url, file)
				})
				return Option.some(downloaded.uri)
			})
		})
	)
)
