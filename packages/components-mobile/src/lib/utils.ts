import {Array, Effect, FiberHandle, Option, Schema, Stream, pipe} from 'effect'

import {createModifier} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult, Atom} from 'effect/reactivity'
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

// A list kept on the iPhone: a cold start shows the copy at once, and each live list is written back once the list settles, off the path that shows it.
export function cachedList<S extends Schema.Top, E, R>(
	get: Atom.AtomContext,
	file: File,
	item: S,
	live: Stream.Stream<Schema.$Array<S>['Type'], E, R>
) {
	const json = Schema.fromJsonString(Schema.Array(item))
	// The empty list shown while the session loads is not a list on screen.
	const shown = Option.exists(
		get.self<AsyncResult.AsyncResult<Schema.$Array<S>['Type']>>(),
		result => AsyncResult.isSuccess(result) && Array.isReadonlyArrayNonEmpty(result.value)
	)
	return Stream.concat(
		// Only a cold start reads the copy, since a list on screen is newer; without one the app waits for the server rather than open on nothing.
		pipe(
			Effect.try(() => file.textSync()),
			Effect.flatMap(Schema.decodeEffect(json)),
			Effect.option,
			Stream.fromEffect,
			Stream.flatMap(cached =>
				Stream.fromIterable(Option.toArray(Option.filter(cached, Array.isReadonlyArrayNonEmpty)))
			),
			Stream.when(Effect.succeed(!shown))
		),
		Stream.unwrap(
			Effect.map(FiberHandle.make(), writes =>
				Stream.tap(live, list =>
					FiberHandle.run(
						writes,
						pipe(
							Schema.encodeEffect(json)(list),
							Effect.flatMap(text => Effect.try(() => writeAtomically(file, text))),
							Effect.delay('2 seconds'),
							Effect.ignore({log: 'Warn', message: `${file.name} could not be kept on this iPhone`})
						)
					)
				)
			)
		)
	)
}

// SwiftUI images read local files, and Metro names each bundled image by a module number.
export const assetAtom = Atom.family((module: number | string) =>
	Atom.make(
		Effect.map(
			Effect.tryPromise(() => Asset.fromModule(module).downloadAsync()),
			asset => asset.localUri ?? asset.uri
		)
	)
)
