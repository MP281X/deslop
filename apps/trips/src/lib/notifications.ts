import {Effect, Queue, Redacted, Schema, Stream, pipe} from 'effect'

import {applicationId} from 'expo-application'
import {
	addPushTokenListener,
	getDevicePushTokenAsync,
	requestPermissionsAsync,
	setNotificationHandler
} from 'expo-notifications'
import {addPushToStartTokenListener} from 'expo-widgets'

import {foregroundNotifications} from '@deslop/components-mobile/notifications'

import {RpcClient, session} from '#lib/session.ts'
import {BookingsError} from '#services/bookings/schema.ts'
import {ApnsToken, Bundle} from '#services/push/schema.ts'

const apns = Effect.map(Schema.decodeUnknownEffect(Bundle)(applicationId), bundle => ({bundle}))

setNotificationHandler(foregroundNotifications)

// Asked on the first launch: gate changes and delays reach the iPhone through these, and the server starts the island with the push-to-start token.
export const pushAtom = RpcClient.runtime.atom(get =>
	Effect.ignore(
		Effect.gen(function* () {
			if (!session.signedIn(get)) return
			const target = yield* apns
			const client = yield* RpcClient
			if (
				(yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The notification permission could not be asked.'}),
					try: () => requestPermissionsAsync()
				})).granted
			) {
				// Subscribe before reading the first token, so a rotation while the app stays open reaches the same registry.
				yield* pipe(
					Stream.callback<string, BookingsError>(queue =>
						Effect.gen(function* () {
							yield* Effect.acquireRelease(
								Effect.sync(() =>
									addPushTokenListener(token => {
										Queue.offerUnsafe(queue, `${token.data}`)
									})
								),
								subscription => Effect.sync(() => subscription.remove())
							)
							const token = yield* Effect.tryPromise({
								catch: cause => BookingsError.make({cause, message: 'The push token could not be read.'}),
								try: () => getDevicePushTokenAsync()
							})
							yield* Queue.offer(queue, `${token.data}`)
						})
					),
					Stream.changes,
					Stream.runForEach(token =>
						Effect.ignore(
							client('push.register', {...target, kind: 'alert', token: Redacted.make(ApnsToken.make(token))}),
							{log: 'Warn', message: 'The notification token was not registered'}
						)
					),
					Effect.forkScoped
				)
			}
			// iOS hands out the push-to-start token and its rotations whenever it likes, for as long as the app runs.
			yield* Stream.runForEach(
				Stream.callback<string>(queue =>
					Effect.acquireRelease(
						Effect.sync(() =>
							addPushToStartTokenListener(event => {
								Queue.offerUnsafe(queue, event.activityPushToStartToken)
							})
						),
						subscription => Effect.sync(() => subscription.remove())
					)
				),
				token =>
					Effect.ignore(
						client('push.register', {...target, kind: 'start', token: Redacted.make(ApnsToken.make(token))}),
						{log: 'Warn', message: 'The Live Activity token was not registered'}
					)
			)
		}),
		{log: 'Warn', message: 'Notifications are not set up on this iPhone'}
	)
)
