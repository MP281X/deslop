import {Boolean, Effect, Function, MutableRef, Option, Queue, Schema, Stream, String, pipe} from 'effect'

import {App} from '@capacitor/app'
import {PushNotifications} from '@capacitor/push-notifications'

import {isNative} from '@deslop/ui/native'

import {FlightId, Place} from '#contracts'

import {directionsTo, rideTo} from '#web/flights/directions.ts'
import {listener, nativeCall} from '#web/flights/notifications.ts'

type Target = typeof Target.Type
const Target = Schema.Struct({day: Schema.Boolean, id: FlightId})

// The whole native link must name a flight UUID belonging to Trips.
function targetIn(url: string) {
	return pipe(
		url,
		String.match(/^trips(?:-dev)?:\/\/(flight|day)\/([^/?#]+)$/u),
		Option.flatMap(parts =>
			Option.map(Schema.decodeUnknownOption(FlightId)(parts[2]), id => ({day: parts[1] === 'day', id}))
		)
	)
}

type Body = typeof Body.Type
const Body = Schema.Struct({flightId: FlightId, place: Schema.optionalKey(Place)})
type Payload = typeof Payload.Type
const Payload = Schema.Struct({body: Body})

const nativeOpens = Stream.callback<Target>(queue =>
	Effect.ignore(
		Effect.gen(function* () {
			const delivered = MutableRef.make(false)
			function offer(target: Option.Option<Target>) {
				Option.map(target, flight => {
					MutableRef.set(delivered, true)
					Queue.offerUnsafe(queue, flight)
				})
			}
			yield* listener(() =>
				App.addListener('appUrlOpen', event => {
					offer(targetIn(event.url))
				})
			)
			yield* listener(() =>
				PushNotifications.addListener('pushNotificationActionPerformed', response => {
					offer(
						Option.map(Schema.decodeUnknownOption(Payload)(response.notification.data), payload => {
							if (payload.body.place !== undefined && response.actionId === 'directions') {
								location.assign(directionsTo(payload.body.place))
							}
							if (payload.body.place !== undefined && response.actionId === 'uber') {
								const ride = Option.getOrUndefined(rideTo(payload.body.place))
								if (ride !== undefined) location.assign(ride)
							}
							return {day: false, id: payload.body.flightId}
						})
					)
				})
			)
			const launch = yield* nativeCall(() => App.getLaunchUrl(), 'The initial flight link could not be read.')
			if (launch !== undefined && !MutableRef.get(delivered)) offer(targetIn(launch.url))
		}),
		{log: 'Warn', message: 'Trips could not open links from iOS'}
	)
)

export const opened = Boolean.match(isNative, {
	onFalse: Function.constant(Stream.empty),
	onTrue: Function.constant(nativeOpens)
})
