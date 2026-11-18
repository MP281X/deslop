import {Effect, Option, Redacted, Schema} from 'effect'

import {applicationId} from 'expo-application'
import {
	addPushTokenListener,
	getDevicePushTokenAsync,
	requestPermissionsAsync,
	setNotificationHandler
} from 'expo-notifications'
import {addPushToStartTokenListener} from 'expo-widgets'

import {registerPushTokens} from '@deslop/runtime/mobile/push-token'
import {ApnsToken} from '@deslop/runtime/shared/apns'

import {RpcClient, session} from '#lib/session.ts'
import {BookingsError} from '#services/bookings/schema.ts'
import {PushBundle} from '#services/push/schema.ts'

const apns = Effect.map(Schema.decodeUnknownEffect(PushBundle)(applicationId), bundle => ({bundle}))

// fallow-ignore-next-line code-duplication -- Each notification app owns its handler so shared components do not autolink notifications into Stash.
setNotificationHandler({
	handleNotification: () =>
		// oxlint-disable-next-line eslint/no-restricted-globals -- expo-notifications' handler contract takes a Promise.
		Promise.resolve({shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true})
})

// Asked on the first launch: gate changes and delays reach the iPhone through these, and the server starts the island with the push-to-start token. The two registrations run apart, so an unanswered permission prompt never holds back the island's token.
export const pushAtom = RpcClient.runtime.atom(get =>
	Effect.ignore(
		Effect.gen(function* () {
			if (Option.isNone(session.admitted(get))) return
			const target = yield* apns
			const client = yield* RpcClient
			const alerts = Effect.gen(function* () {
				const permission = yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The notification permission could not be asked.'}),
					try: () => requestPermissionsAsync()
				})
				if (!permission.granted) return
				// Subscribe before reading the first token, so a rotation while the app stays open reaches the same registry.
				yield* registerPushTokens(
					addPushTokenListener,
					Effect.tryPromise({
						catch: cause => BookingsError.make({cause, message: 'The push token could not be read.'}),
						try: () => getDevicePushTokenAsync()
					}),
					token => client('push.register', {...target, kind: 'alert', token: Redacted.make(ApnsToken.make(token))})
				)
			})
			// iOS hands out the push-to-start token and its rotations to the listener whenever it likes, for as long as the app runs; there is nothing to read first.
			const nothingToRead: Effect.Effect<{data: string}> = Effect.never
			const starts = registerPushTokens(
				listener =>
					addPushToStartTokenListener(event => {
						listener({data: event.activityPushToStartToken})
					}),
				nothingToRead,
				token => client('push.register', {...target, kind: 'start', token: Redacted.make(ApnsToken.make(token))})
			)
			yield* Effect.all(
				[
					Effect.ignore(alerts, {log: 'Warn', message: 'Notifications are not set up on this iPhone'}),
					Effect.ignore(starts, {log: 'Warn', message: 'Live Activities are not set up on this iPhone'})
				],
				{concurrency: 'unbounded', discard: true}
			)
		}),
		{log: 'Warn', message: 'Notifications are not set up on this iPhone'}
	)
)
