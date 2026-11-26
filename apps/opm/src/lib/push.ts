import {Boolean, Cause, Effect, Option, Predicate, Queue, Redacted, Schema, Stream, String, pipe} from 'effect'

import type {PluginListenerHandle} from '@capacitor/core'
import {PushNotifications} from '@capacitor/push-notifications'
import {AtomRegistry} from 'effect/reactivity'

import {registerPushToken} from '@deslop/runtime/client/push'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import {nativeBundle} from '@deslop/ui/native'

import {RpcClient} from '#lib/session.ts'
import {notificationOf} from '#services/chapters/lib/utils.ts'
import type {ChapterIdentity} from '#services/chapters/schema.ts'
import {ChapterBundle, ChapterPushError} from '#services/push/schema.ts'

function pushCall<A>(message: string, call: () => PromiseLike<A>) {
	return Effect.tryPromise({catch: cause => ChapterPushError.make({cause, message}), try: call})
}

function removePushListener(listener: PluginListenerHandle) {
	return Effect.ignore(
		pushCall('The notification listener could not be removed.', () => listener.remove()),
		{log: 'Warn', message: 'Could not stop listening to notifications'}
	)
}

export const notificationOpens = Stream.catch(
	Stream.callback<ChapterIdentity, ChapterPushError>(queue =>
		Effect.acquireRelease(
			pushCall('Notification taps could not be observed.', () =>
				PushNotifications.addListener('pushNotificationActionPerformed', action => {
					if (action.actionId !== 'tap') return
					const payload: unknown = action.notification.data
					if (!Predicate.hasProperty(payload, 'body')) return
					Option.map(notificationOf(payload.body), chapter => Queue.offerUnsafe(queue, chapter))
				})
			),
			removePushListener
		)
	),
	cause => Stream.fromEffectDrain(Effect.logWarning('Could not open chapters from notifications', cause))
)

const tokens = Stream.callback<string, ChapterPushError>(queue =>
	Effect.gen(function* () {
		const permissions = yield* pushCall('Notification permission could not be read.', () =>
			PushNotifications.checkPermissions()
		)
		const answer = yield* Boolean.match(permissions.receive === 'prompt', {
			onFalse: () => Effect.succeed(permissions),
			onTrue: () =>
				pushCall('Notification permission could not be requested.', () => PushNotifications.requestPermissions())
		})
		if (answer.receive !== 'granted') {
			Queue.endUnsafe(queue)
			return
		}
		yield* Effect.acquireRelease(
			pushCall('The APNs token could not be observed.', () =>
				PushNotifications.addListener('registration', token => {
					// Capacitor returns uppercase hex; keep the key the previous app registered.
					Queue.offerUnsafe(queue, String.toLowerCase(token.value))
				})
			),
			removePushListener
		)
		yield* Effect.acquireRelease(
			pushCall('APNs registration errors could not be observed.', () =>
				PushNotifications.addListener('registrationError', failure => {
					Queue.failCauseUnsafe(
						queue,
						Cause.fail(ChapterPushError.make({cause: failure.error, message: 'APNs registration failed.'}))
					)
				})
			),
			removePushListener
		)
		yield* pushCall('Registration with APNs could not start.', () => PushNotifications.register())
	})
)

export const registerPush = pipe(
	tokens,
	Stream.changes,
	Stream.switchMap(value =>
		Stream.fromEffectDrain(
			Effect.gen(function* () {
				const token = yield* Schema.decodeEffect(ApnsToken)(value)
				const bundle = yield* Schema.decodeUnknownEffect(ChapterBundle)(yield* nativeBundle)
				const context = yield* AtomRegistry.getResult(yield* AtomRegistry.AtomRegistry, RpcClient.runtime)
				yield* registerPushToken(
					pipe(
						RpcClient,
						Effect.flatMap(client => client('push.register', {bundle, kind: 'alert', token: Redacted.make(token)})),
						Effect.provideContext(context)
					)
				)
			})
		)
	),
	Stream.catch(cause =>
		Stream.fromEffectDrain(Effect.logWarning('Notifications could not be set up on this iPhone', cause))
	)
)
