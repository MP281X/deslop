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
const DAY_LINK = `${appConfig.extra.scheme}://day/`

// A flight to open: that one, or with `day` the flight its day is at when it shows, as the Live Activity links it.
export type Target = {day: boolean; id: FlightId}

function under(prefix: string, url: string) {
	return pipe(
		Option.some(url),
		Option.filter(String.startsWith(prefix)),
		Option.map(String.slice(prefix.length)),
		Option.flatMap(Schema.decodeOption(FlightId))
	)
}

// Only this app's own flight or day link, the whole of it: another scheme, host or a longer path opens nothing.
function targetIn(url?: string | null) {
	return Option.flatMap(Option.fromNullishOr(url), found =>
		pipe(
			under(FLIGHT_LINK, found),
			Option.map(id => ({day: false, id}) satisfies Target),
			Option.orElse(() => Option.map(under(DAY_LINK, found), id => ({day: true, id}) satisfies Target))
		)
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
		payload => ({day: false, id: payload.flightId}) satisfies Target
	)
}

// What a link or a notification answer asks: the flight to open, and the way to the airport a Leave now action opens.
type Opened = {act: Effect.Effect<void>; flight: Option.Option<Target>}

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
							Option.flatMap(targetIn),
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
									Queue.offerUnsafe(queue, {act: Effect.void, flight: targetIn(event.url)})
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
