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

import {directionsTo, rideTo} from '#lib/rides.ts'
import {FlightId, FlightsError, Place} from '#services/flights/schema.ts'

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

const WAYS = {directions: directionsTo, uber: rideTo}
type Way = typeof Way.Type
const Way = Schema.Literals(['directions', 'uber'])

// A Leave now notification's Directions or Uber opens the way to the airport it names.
function act(response: NotificationResponse | null) {
	return pipe(
		Option.fromNullishOr(response),
		Option.flatMap(found =>
			Option.all({
				place: Option.map(
					Schema.decodeUnknownOption(Schema.Struct({place: Place}))(found.notification.request.content.data),
					payload => payload.place
				),
				way: Schema.decodeUnknownOption(Way)(found.actionIdentifier)
			})
		),
		Option.match({
			onNone: () => Effect.void,
			onSome: found =>
				Effect.ignore(WAYS[found.way](found.place), {log: 'Warn', message: 'A Leave now action did not open'})
		})
	)
}

function tapped(response: NotificationResponse | null) {
	return Option.map(
		Schema.decodeUnknownOption(Schema.Struct({flightId: FlightId}))(response?.notification.request.content.data),
		payload => payload.flightId
	)
}

// What a link or a notification answer asks: the flight to open, and the way to the airport a Leave now action opens.
type Opened = {act: Effect.Effect<void>; flight: Option.Option<FlightId>}

function answered(response: NotificationResponse | null) {
	return {act: act(response), flight: tapped(response)} satisfies Opened
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
						// A notification answered while the app was closed launches it without a URL.
						pipe(
							url,
							Option.flatMap(flightIn),
							Option.match({
								onNone: () => {
									// The answer that launched the app counts once; a later start of this atom must not open it again.
									const launch = answered(getLastNotificationResponse())
									clearLastNotificationResponse()
									return launch
								},
								onSome: flight => ({act: Effect.void, flight: Option.some(flight)})
							})
						)
				)
			),
			Stream.merge(
				Stream.callback<Opened>(queue =>
					Effect.gen(function* () {
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Linking.addEventListener('url', event =>
									Queue.offerUnsafe(queue, {act: Effect.void, flight: flightIn(event.url)})
								)
							),
							subscription => Effect.sync(() => subscription.remove())
						)
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								addNotificationResponseReceivedListener(response => {
									Queue.offerUnsafe(queue, answered(response))
								})
							),
							subscription => Effect.sync(() => subscription.remove())
						)
					})
				)
			),
			Stream.tap(opened => opened.act),
			Stream.flatMap(opened => Stream.fromIterable(Option.toArray(opened.flight)))
		)
	)
)
