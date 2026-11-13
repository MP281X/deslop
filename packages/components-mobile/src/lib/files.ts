import {Effect, FiberHandle, Function, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import type {AtomRegistry, Atom} from 'effect/reactivity'
import {File} from 'expo-file-system'

import {isDeniedCause, keepValueThroughOutages} from '@deslop/runtime/client/live-stream'

class DeviceError extends Schema.TaggedError<DeviceError>()('DeviceError', {
	cause: Schema.Defect(),
	message: Schema.String
}) {}

// A killed app never leaves half a file behind.
export function writeAtomically(file: File, text: string) {
	const temporary = new File(`${file.uri}.tmp`)
	temporary.writeSync(text)
	temporary.moveSync(file, {overwrite: true})
}

// A cold start hydrates from disk, and writes stay off the path that shows the list.
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
	const hydrate = Option.match(get.self<AsyncResult.AsyncResult<Schema.$Array<S>['Type'], E>>(), {
		onNone: () => true,
		onSome: result => {
			if (Option.isSome(AsyncResult.value(result))) return false
			if (!AsyncResult.isFailure(result)) return true
			return !isDeniedCause(result.cause)
		}
	})
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
			Stream.when(Effect.succeed(hydrate))
		),
		Stream.unwrap(
			Effect.gen(function* () {
				const writes = yield* FiberHandle.make()
				return keepValueThroughOutages(
					get,
					pipe(
						live,
						Stream.tap(list =>
							FiberHandle.run(
								writes,
								pipe(
									Schema.encodeEffect(json)(list),
									Effect.flatMap(text =>
										Effect.try({
											catch: cause =>
												DeviceError.make({cause, message: `${file.name} could not be written on this iPhone`}),
											try: () => writeAtomically(file, text)
										})
									),
									Effect.delay('2 seconds'),
									Effect.ignore({log: 'Warn', message: `${file.name} could not be kept on this iPhone`})
								)
							)
						),
						Stream.tapCause(failure => {
							if (!isDeniedCause(failure)) return Effect.void
							return pipe(
								// A write waiting out its pause must not restore the file after the denial removed it.
								FiberHandle.clear(writes),
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
