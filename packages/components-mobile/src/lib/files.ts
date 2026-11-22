import {Effect, Equal, FiberHandle, Function, MutableHashMap, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import type {AtomRegistry, Atom} from 'effect/reactivity'
import {requireNativeModule} from 'expo'
import type {File} from 'expo-file-system'

import {isDeniedCause, keepValueThroughOutages} from '@deslop/runtime/client/live-stream'
import type {Session} from '@deslop/runtime/mobile/session'
import {UserId} from '@deslop/runtime/shared/auth'

import {DeviceError} from '#lib/errors.ts'

// ios/DeslopComponentsModule.swift writes beside the file and renames over it in one step, so a killed app leaves the old text or the new one, never neither.
export function writeAtomically(file: File, text: string) {
	requireNativeModule<{writeAtomically: (uri: string, text: string) => void}>('DeslopComponents').writeAtomically(
		file.uri,
		text
	)
}

// Whose list each cached atom holds in memory, by its file.
const owners = MutableHashMap.empty<string, UserId>()

// A cold start hydrates from disk, and writes stay off the path that shows the list. The copy belongs to the admitted account: a refusal or a sign-out removes it, and another account never opens on it.
export function cachedList<S extends Schema.Top, E, R>(
	get: Atom.AtomContext,
	session: Session,
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
	const CachedList = Schema.fromJsonString(Schema.Struct({account: UserId, items: Schema.Array(item)}))
	const admitted = session.admitted(get)
	// A list in memory was read for one account; any other start, signed out included, shows nothing until its own list arrives.
	if (!Equal.equals(admitted, MutableHashMap.get(owners, file.uri))) {
		MutableHashMap.modifyAt(owners, file.uri, Function.constant(admitted))
		get.setSelf(AsyncResult.initial<Schema.$Array<S>['Type'], E>())
	}
	const remove = pipe(
		Effect.try({
			catch: cause => DeviceError.make({cause, message: `${file.name} could not be removed from this iPhone`}),
			try: () => {
				if (file.exists) file.delete()
			}
		}),
		Effect.ignore({log: 'Warn', message: `${file.name} could not be removed for an account that left`}),
		Effect.uninterruptible
	)
	return Option.match(admitted, {
		onNone: () => Stream.concat(Stream.fromEffectDrain(remove), Stream.never),
		onSome: account => {
			const hydrate = Option.match(get.self<AsyncResult.AsyncResult<Schema.$Array<S>['Type'], E>>(), {
				onNone: Function.constTrue,
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
					Effect.flatMap(Schema.decodeEffect(CachedList)),
					Effect.option,
					Stream.fromEffect,
					Stream.flatMap(cached =>
						pipe(
							cached,
							Option.filter(copy => copy.account === account),
							Option.map(copy => copy.items),
							Option.toArray,
							Stream.fromIterable
						)
					),
					Stream.when(Effect.succeed(hydrate))
				),
				Stream.unwrap(
					Effect.gen(function* () {
						const writes = yield* FiberHandle.make()
						return keepValueThroughOutages(
							get,
							pipe(
								live,
								Stream.tap(items =>
									FiberHandle.run(
										writes,
										pipe(
											Schema.encodeEffect(CachedList)({account, items}),
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
									// A write waiting out its pause must not restore the file after the denial removed it.
									return Effect.andThen(FiberHandle.clear(writes), remove)
								})
							),
							recover
						)
					})
				)
			)
		}
	})
}
