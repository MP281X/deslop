import {Effect, Option, Queue, Schema, String, Stream, pipe} from 'effect'

import {Atom} from 'effect/reactivity'
import {
	addNotificationResponseReceivedListener,
	clearLastNotificationResponse,
	getLastNotificationResponse
} from 'expo-notifications'
import type {NotificationResponse} from 'expo-notifications'
import {Linking} from 'react-native'

import {appConfig} from '@deslop/runtime/mobile/app'

import {BookingId, BookingsError} from '#services/bookings/schema.ts'

const BOOKING_LINK = `${appConfig.extra.scheme}://booking/`

// Only this app's own booking link, the whole of it: another scheme, host or a longer path opens nothing.
function bookingIn(url?: string | null) {
	return pipe(
		Option.fromNullishOr(url),
		Option.filter(String.startsWith(BOOKING_LINK)),
		Option.map(String.slice(BOOKING_LINK.length)),
		Option.flatMap(Schema.decodeOption(BookingId))
	)
}

function tapped(response: NotificationResponse | null) {
	return Option.map(
		Schema.decodeUnknownOption(Schema.Struct({bookingId: BookingId}))(response?.notification.request.content.data),
		payload => payload.bookingId
	)
}

export const openedAtom = Atom.keepAlive(
	Atom.make(
		pipe(
			Stream.fromEffect(
				Effect.map(
					pipe(
						Effect.tryPromise({
							catch: cause => BookingsError.make({cause, message: 'The initial booking link could not be read.'}),
							try: () => Linking.getInitialURL()
						}),
						Effect.tapError(error => Effect.logWarning('The initial booking link could not be read', error)),
						Effect.option
					),
					url =>
						// A notification tapped while the app was closed launches it without a URL.
						pipe(
							url,
							Option.flatMap(bookingIn),
							Option.orElse(() => {
								// The tap that launched the app opens it once; a later start of this atom must not open it again.
								const launch = tapped(getLastNotificationResponse())
								clearLastNotificationResponse()
								return launch
							})
						)
				)
			),
			Stream.merge(
				Stream.callback<Option.Option<BookingId>>(queue =>
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
				)
			),
			Stream.flatMap(opened => Stream.fromIterable(Option.toArray(opened)))
		)
	)
)
