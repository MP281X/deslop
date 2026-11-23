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

import {FlightId, FlightsError} from '#services/flights/schema.ts'

const FLIGHT_LINK = `${appConfig.extra.scheme}://flight/`

// Only this app's own flight link, the whole of it: another scheme, host or a longer path opens nothing.
function flightIn(url?: string | null) {
	return pipe(
		Option.fromNullishOr(url),
		Option.filter(String.startsWith(FLIGHT_LINK)),
		Option.map(String.slice(FLIGHT_LINK.length)),
		Option.flatMap(Schema.decodeOption(FlightId))
	)
}

function tapped(response: NotificationResponse | null) {
	return Option.map(
		Schema.decodeUnknownOption(Schema.Struct({flightId: FlightId}))(response?.notification.request.content.data),
		payload => payload.flightId
	)
}

export const openedAtom = Atom.keepAlive(
	Atom.make(
		pipe(
			Stream.fromEffect(
				Effect.map(
					pipe(
						Effect.tryPromise({
							catch: cause => FlightsError.make({cause, message: 'The initial flight link could not be read.'}),
							try: () => Linking.getInitialURL()
						}),
						Effect.tapError(error => Effect.logWarning('The initial flight link could not be read', error)),
						Effect.option
					),
					url =>
						// A notification tapped while the app was closed launches it without a URL.
						pipe(
							url,
							Option.flatMap(flightIn),
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
				Stream.callback<Option.Option<FlightId>>(queue =>
					Effect.gen(function* () {
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Linking.addEventListener('url', event => Queue.offerUnsafe(queue, flightIn(event.url)))
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
