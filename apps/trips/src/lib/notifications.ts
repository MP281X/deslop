import {Effect, Option, Redacted, Schema} from 'effect'

import {applicationId, getIosIdForVendorAsync} from 'expo-application'
import {
	addPushTokenListener,
	getDevicePushTokenAsync,
	requestPermissionsAsync,
	setNotificationCategoryAsync,
	setNotificationHandler
} from 'expo-notifications'
import {addPushToStartTokenListener} from 'expo-widgets'

import {registerPushTokens} from '@deslop/runtime/mobile/push-token'
import {ApnsToken} from '@deslop/runtime/shared/apns'

import {RpcClient, session} from '#lib/session.ts'
import {FlightsError} from '#services/flights/schema.ts'
import {PhoneId, PushBundle} from '#services/push/schema.ts'

// The app and the iPhone each token belongs to, so a Live Activity tells its changes only on the phone it runs on.
const apns = Effect.all(
	{
		bundle: Schema.decodeUnknownEffect(PushBundle)(applicationId),
		phone: Effect.flatMap(
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'iOS did not name this iPhone.'}),
				try: () => getIosIdForVendorAsync()
			}),
			Schema.decodeUnknownEffect(PhoneId)
		)
	},
	{concurrency: 'unbounded'}
)

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
					catch: cause => FlightsError.make({cause, message: 'The notification permission could not be asked.'}),
					try: () => requestPermissionsAsync()
				})
				if (!permission.granted) return
				// Leave now offers the way to the airport without opening Trips first.
				yield* Effect.tryPromise({
					catch: cause => FlightsError.make({cause, message: 'The Leave now actions could not be set up.'}),
					try: () =>
						setNotificationCategoryAsync('leave', [
							{buttonTitle: 'Directions', identifier: 'directions', options: {opensAppToForeground: true}},
							{buttonTitle: 'Uber', identifier: 'uber', options: {opensAppToForeground: true}}
						])
				})
				// Subscribe before reading the first token, so a rotation while the app stays open reaches the same registry.
				yield* registerPushTokens(
					addPushTokenListener,
					Effect.tryPromise({
						catch: cause => FlightsError.make({cause, message: 'The push token could not be read.'}),
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
