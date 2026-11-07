import {
	Array,
	Cause,
	Effect,
	FiberHandle,
	Function,
	MutableHashMap,
	MutableRef,
	Option,
	Schema,
	Stream,
	pipe
} from 'effect'

import {createModifier} from '@expo/ui/swift-ui/modifiers'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {AtomRegistry} from 'effect/reactivity'
import {requireNativeModule} from 'expo'
import {Asset} from 'expo-asset'
import {File} from 'expo-file-system'
import {Alert} from 'react-native'

import {isDenied, withoutDeniedData} from '@deslop/runtime/auth/utils'

class DeviceError extends Schema.TaggedError<DeviceError>()('DeviceError', {
	cause: Schema.Defect(),
	message: Schema.String
}) {}

export function clipboardChangeCount() {
	return requireNativeModule<{clipboardChangeCount: () => number}>('DeslopComponents').clipboardChangeCount()
}

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

const cacheOwners = MutableHashMap.empty<
	string,
	{generation: MutableRef.MutableRef<number>; readers: MutableRef.MutableRef<number>}
>()

// A list kept on the iPhone: a cold start shows the copy at once, and each live list is written back once the list settles, off the path that shows it.
export function cachedList<S extends Schema.Top, E, R>(
	get: Atom.AtomContext,
	file: File,
	item: S,
	live: Stream.Stream<Schema.$Array<S>['Type'], E, R>,
	recover: (
		stream: Stream.Stream<Schema.$Array<S>['Type'], E, R | S['EncodingServices']>
	) => Stream.Stream<
		Schema.$Array<S>['Type'],
		E,
		R | S['EncodingServices'] | AtomRegistry.AtomRegistry
	> = Function.identity
) {
	const json = Schema.fromJsonString(Schema.Array(item))
	const shown = Option.isSome(
		Option.flatMap(get.self<AsyncResult.AsyncResult<Schema.$Array<S>['Type']>>(), AsyncResult.value)
	)
	return Stream.concat(
		// Only a cold start reads the copy, since a list on screen is newer; without one the app waits for the server rather than open on nothing.
		pipe(
			Effect.try({
				catch: cause => DeviceError.make({cause, message: `${file.name} could not be read on this iPhone`}),
				try: () => file.textSync()
			}),
			Effect.flatMap(Schema.decodeEffect(json)),
			Effect.option,
			Stream.fromEffect,
			Stream.flatMap(cached => Stream.fromIterable(Option.toArray(cached))),
			Stream.when(Effect.succeed(!shown))
		),
		Stream.unwrap(
			Effect.gen(function* () {
				const cache = yield* Effect.acquireRelease(
					Effect.sync(() => {
						const owner = Option.getOrElse(MutableHashMap.get(cacheOwners, file.uri), () => ({
							generation: MutableRef.make(0),
							readers: MutableRef.make(0)
						}))
						MutableRef.update(owner.readers, count => count + 1)
						MutableHashMap.set(cacheOwners, file.uri, owner)
						return owner
					}),
					owner =>
						Effect.sync(() => {
							if (MutableRef.updateAndGet(owner.readers, count => count - 1) === 0) {
								MutableHashMap.remove(cacheOwners, file.uri)
							}
						})
				)
				const writes = yield* FiberHandle.make()
				return withoutDeniedData(
					get,
					pipe(
						live,
						Stream.tap(list => {
							const generation = MutableRef.get(cache.generation)
							return FiberHandle.run(
								writes,
								pipe(
									Schema.encodeEffect(json)(list),
									Effect.flatMap(text =>
										Effect.try({
											catch: cause =>
												DeviceError.make({cause, message: `${file.name} could not be written on this iPhone`}),
											try: () => {
												if (generation === MutableRef.get(cache.generation)) writeAtomically(file, text)
											}
										})
									),
									Effect.delay('2 seconds'),
									Effect.ignore({log: 'Warn', message: `${file.name} could not be kept on this iPhone`})
								)
							)
						}),
						Stream.tapCause(failure => {
							if (!Array.some(failure.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))) {
								return Effect.void
							}
							return pipe(
								Effect.sync(() => MutableRef.update(cache.generation, count => count + 1)),
								Effect.andThen(FiberHandle.clear(writes)),
								Effect.andThen(
									Effect.try({
										catch: cause =>
											DeviceError.make({cause, message: `${file.name} could not be removed from this iPhone`}),
										try: () => {
											if (file.exists) file.delete()
										}
									})
								),
								Effect.ignore({log: 'Warn', message: `${file.name} could not be removed after access was denied`}),
								Effect.uninterruptible
							)
						})
					),
					recover
				)
			})
		)
	)
}

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
