import {Effect, Option, Queue, Schema, String, Stream, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {addNotificationResponseReceivedListener, getLastNotificationResponse} from 'expo-notifications'
import type {NotificationResponse} from 'expo-notifications'
import {Linking} from 'react-native'

import {appConfig} from '@deslop/runtime/mobile/app'

export function linkOf(bookingId: string) {
	return `${appConfig.extra.scheme}://booking/${bookingId}`
}

function bookingIn(url?: string | null) {
	return Option.flatMap(Option.fromNullishOr(url), link =>
		Option.flatMap(String.match(/booking\/([0-9a-f-]{36})/iu)(link), match => Option.fromUndefinedOr(match[1]))
	)
}

function tapped(response: NotificationResponse | null) {
	return Option.map(
		Schema.decodeUnknownOption(Schema.Struct({bookingId: Schema.String}))(response?.notification.request.content.data),
		data => data.bookingId
	)
}

export const openedAtom = Atom.keepAlive(
	Atom.make(
		pipe(Stream.fromEffect(
					Effect.map(
						Effect.promise(() => Linking.getInitialURL()),
						url =>
							// A notification tapped while the app was closed launches it without a URL.
							Option.orElse(bookingIn(url), () => tapped(getLastNotificationResponse()))
					)
				), pipelineSubject991 => Stream.merge(pipelineSubject991, Stream.callback<Option.Option<string>>(queue =>
					Effect.gen(function* () {
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Linking.addEventListener('url', event => Queue.offerUnsafe(queue, bookingIn(event.url)))
							),
							subscription => Effect.sync(() => subscription.remove())
						)
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								addNotificationResponseReceivedListener(response => {
									Queue.offerUnsafe(queue, tapped(response))
								})
							),
							subscription => Effect.sync(() => subscription.remove())
						)
					})
				)), Stream.flatMap(opened => Stream.fromIterable(Option.toArray(opened))))
	)
)
