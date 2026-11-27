import {Cause, Effect, Queue, Redacted, Schema, Stream, pipe} from 'effect'

import {registerPlugin} from '@capacitor/core'
import type {PluginListenerHandle} from '@capacitor/core'
import {PushNotifications} from '@capacitor/push-notifications'

import {registerPushToken} from '@deslop/runtime/client/push'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import type {Device as ApnsDevice} from '@deslop/runtime/shared/apns'
import {isNative, listenNative, registerTokens} from '@deslop/ui/native'

import {FlightsError, PhoneId, PushBundle} from '#contracts'

import {ownerAtom} from '#web/flights/data.ts'
import {RpcClient} from '#web/flights/session.ts'

// oxlint-disable-next-line typescript/no-restricted-types -- Capacitor's bridge methods return promises.
export type NativeResult<A> = Promise<A>

type TripsNativePlugin = {
	addListener: (
		event: 'activityToken',
		listener: (event: {value: string}) => void
	) => NativeResult<PluginListenerHandle>
	device: () => NativeResult<unknown>
	prepareNotifications: () => NativeResult<void>
	watchActivityToken: () => NativeResult<void>
}

const TripsNative = registerPlugin<TripsNativePlugin>('TripsNative')
type Device = typeof Device.Type
const Device = Schema.Struct({bundle: PushBundle, phone: PhoneId})

export function nativeCall<A>(read: () => NativeResult<A>, message: string) {
	return Effect.tryPromise({catch: cause => FlightsError.make({cause, message}), try: read})
}

export function listener(acquire: () => NativeResult<PluginListenerHandle>) {
	return listenNative(
		acquire,
		cause => FlightsError.make({cause, message: 'iOS could not listen for Trips updates.'}),
		cause => FlightsError.make({cause, message: 'iOS could not stop listening for Trips updates.'})
	)
}

const alerts = Stream.callback<string, FlightsError>(queue =>
	Effect.gen(function* () {
		const permission = yield* nativeCall(
			() => PushNotifications.requestPermissions(),
			'Notifications could not be requested.'
		)
		if (permission.receive !== 'granted') {
			yield* Queue.end(queue)
			return
		}
		yield* nativeCall(() => TripsNative.prepareNotifications(), 'The Leave now actions could not be set up.')
		yield* listener(() =>
			PushNotifications.addListener('registration', token => {
				Queue.offerUnsafe(queue, token.value)
			})
		)
		yield* listener(() =>
			PushNotifications.addListener('registrationError', error => {
				Queue.failCauseUnsafe(queue, Cause.fail(FlightsError.make({message: error.error})))
			})
		)
		yield* nativeCall(() => PushNotifications.register(), 'The iPhone could not register for push.')
	})
)

const starts = Stream.callback<string, FlightsError>(queue =>
	Effect.gen(function* () {
		yield* listener(() =>
			TripsNative.addListener('activityToken', token => {
				Queue.offerUnsafe(queue, token.value)
			})
		)
		yield* nativeCall(() => TripsNative.watchActivityToken(), 'The iPhone could not watch its Live Activity token.')
	})
)

export const pushAtom = RpcClient.runtime.atom(get => {
	if (!isNative || get(ownerAtom) === undefined) return Effect.void
	return Effect.ignore(
		Effect.gen(function* () {
			const target = yield* Effect.flatMap(
				nativeCall(() => TripsNative.device(), 'iOS did not name this iPhone.'),
				Schema.decodeUnknownEffect(Device)
			)
			const call = yield* RpcClient
			function tokens(source: typeof alerts, kind: ApnsDevice['kind']) {
				return pipe(
					registerTokens(source, value =>
						registerPushToken(
							Effect.flatMap(Schema.decodeEffect(ApnsToken)(value), token =>
								call('push.register', {...target, kind, token: Redacted.make(token)})
							)
						)
					),
					Stream.runDrain,
					Effect.ignore({log: 'Warn', message: `The ${kind} token could not be read`})
				)
			}
			yield* Effect.all([tokens(alerts, 'alert'), tokens(starts, 'start')], {concurrency: 'unbounded', discard: true})
		}),
		{log: 'Warn', message: 'Trips could not register this iPhone'}
	)
})
