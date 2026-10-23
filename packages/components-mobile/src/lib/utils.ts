import {Effect} from 'effect'

import {createModifier} from '@expo/ui/swift-ui/modifiers'
import {Atom} from 'effect/reactivity'
import {Asset} from 'expo-asset'
import {File} from 'expo-file-system'
import {Alert} from 'react-native'

export function alert(title: string) {
	return <A, E extends {message: string}, R>(effect: Effect.Effect<A, E, R>) =>
		Effect.tapError(effect, error => Effect.sync(() => Alert.alert(title, error.message)))
}

// ios/DeslopComponentsModule.swift: the search field in the middle of the bottom bar, between the toolbar's own items.
export const bottomBarSearch = createModifier('bottomBarSearch')

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
