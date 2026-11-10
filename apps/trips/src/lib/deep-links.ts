import {Effect, Option, Queue, Schema, String, Stream, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import * as Notifications from 'expo-notifications'
import {Linking} from 'react-native'

import * as MobileRuntime from '@deslop/runtime/mobile'

export function linkOf(bookingId: string) {
	return `${MobileRuntime.extra.scheme}://booking/${bookingId}`
}

function bookingIn(url?: string | null) {
	return Option.flatMap(Option.fromNullishOr(url), link =>
		Option.flatMap(String.match(/booking\/([0-9a-f-]{36})/iu)(link), match => Option.fromUndefinedOr(match[1]))
	)
}

function tapped(response: Notifications.NotificationResponse | null) {
	return Option.map(
		Schema.decodeUnknownOption(Schema.Struct({bookingId: Schema.String}))(response?.notification.request.content.data),
		data => data.bookingId
	)
}

export const openedAtom = Atom.keepAlive(
	Atom.make(
		pipe(
			Stream.merge(
				Stream.fromEffect(
					Effect.map(
						Effect.promise(() => Linking.getInitialURL()),
						url =>
							// A notification tapped while the app was closed launches it without a URL.
							Option.orElse(bookingIn(url), () => tapped(Notifications.getLastNotificationResponse()))
					)
				),
				Stream.callback<Option.Option<string>>(queue =>
					Effect.gen(function* () {
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Linking.addEventListener('url', event => Queue.offerUnsafe(queue, bookingIn(event.url)))
							),
							subscription => Effect.sync(() => subscription.remove())
						)
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Notifications.addNotificationResponseReceivedListener(response => {
									Queue.offerUnsafe(queue, tapped(response))
								})
							),
							subscription => Effect.sync(() => subscription.remove())
						)
					})
				)
			),
			Stream.flatMap(opened => Stream.fromIterable(Option.toArray(opened)))
		)
	)
)
