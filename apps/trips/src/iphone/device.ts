import {Effect, Function, Option, Queue, Schema, Stream, String, pipe} from 'effect'

import {requireNativeModule} from 'expo'
import {
	addNotificationResponseReceivedListener,
	addPushTokenListener,
	clearLastNotificationResponse,
	getDevicePushTokenAsync,
	getLastNotificationResponse,
	requestPermissionsAsync,
	setNotificationCategoryAsync,
	setNotificationHandler
} from 'expo-notifications'
import type {NotificationResponse} from 'expo-notifications'
import AppState from 'react-native/Libraries/AppState/AppState'
import Linking from 'react-native/Libraries/Linking/Linking'

import {FlightId, FlightsError, Place} from '#contracts'

import {appOrigin, scheme} from '#iphone/origin.ts'
import {PushPhone} from '#screens/data.ts'
import {directionsTo, rideTo} from '#screens/directions.ts'
import {Message} from '#screens/model.ts'
import {TripsRoute, flightRoute} from '#screens/routes.ts'

type ActivityModule = {
	device: () => PromiseLike<unknown>
	addListener: (event: 'activityToken', callback: (token: {value: string}) => void) => {remove: () => void}
}

function activity() {
	return requireNativeModule<ActivityModule>('TripsActivity')
}

function nativeCall<A>(read: () => PromiseLike<A>, message: string) {
	return Effect.tryPromise({catch: cause => FlightsError.make({cause, message}), try: read})
}

function listen(attach: () => {remove: () => void}) {
	return Effect.acquireRelease(Effect.sync(attach), subscription => Effect.sync(() => subscription.remove()))
}

setNotificationHandler({
	// oxlint-disable-next-line eslint/require-await -- Expo awaits the synchronous foreground presentation decision.
	handleNotification: async () => ({
		shouldPlaySound: true,
		shouldSetBadge: false,
		shouldShowBanner: true,
		shouldShowList: true
	})
})

const alerts = Stream.callback<string, FlightsError>(queue =>
	Effect.gen(function* () {
		const permission = yield* nativeCall(() => requestPermissionsAsync(), 'Notifications could not be requested.')
		if (!permission.granted) {
			yield* Queue.end(queue)
			return
		}
		yield* nativeCall(
			() =>
				setNotificationCategoryAsync('leave', [
					{buttonTitle: 'Directions', identifier: 'directions', options: {opensAppToForeground: true}},
					{buttonTitle: 'Uber', identifier: 'uber', options: {opensAppToForeground: true}}
				]),
			'The Leave now actions could not be set up.'
		)
		yield* listen(() =>
			addPushTokenListener(token => {
				if (token.type === 'ios') Queue.offerUnsafe(queue, token.data)
			})
		)
		const token = yield* nativeCall(() => getDevicePushTokenAsync(), 'The iPhone could not register for push.')
		if (token.type === 'ios') yield* Queue.offer(queue, token.data)
	})
)

const starts = Stream.callback<string, FlightsError>(queue =>
	listen(() =>
		activity().addListener('activityToken', token => {
			Queue.offerUnsafe(queue, token.value)
		})
	)
)

export const push = {
	alerts,
	device: Effect.flatMap(
		nativeCall(() => activity().device(), 'iOS did not name this iPhone.'),
		Schema.decodeUnknownEffect(PushPhone)
	),
	starts
}

export function openUrl(url: string) {
	return Effect.asVoid(nativeCall(() => Linking.openURL(url), 'The link could not be opened.'))
}

function routeIn(url: string) {
	const app = `${scheme}://`
	if (String.startsWith(app)(url)) {
		const path = String.slice(app.length)(url)
		return TripsRoute.parse(String.startsWith('/')(path) ? path : `/${path}`)
	}
	if (!String.startsWith(`${appOrigin}/`)(url)) return Option.none<TripsRoute>()
	return TripsRoute.parse(String.slice(appOrigin.length)(url))
}

export const initialPath = Effect.map(
	Effect.promise(() => Linking.getInitialURL()),
	url =>
		pipe(
			Option.fromNullishOr(url),
			Option.flatMap(routeIn),
			Option.map(TripsRoute.print),
			Option.getOrElse(Function.constant('/'))
		)
)

// Expo exposes the APNs userInfo.body dictionary as content.data.
const Notification = Schema.Struct({flightId: FlightId, place: Schema.optionalKey(Place)})

export const deviceEvents = Stream.callback<Message>(queue =>
	Effect.gen(function* () {
		yield* listen(() =>
			AppState.addEventListener('change', state => {
				if (state === 'active') Queue.offerUnsafe(queue, Message.Retry())
			})
		)
		yield* listen(() =>
			Linking.addEventListener('url', ({url}) => {
				Option.map(routeIn(url), route => Queue.offerUnsafe(queue, Message.Opened({route})))
			})
		)
		function responded(response: NotificationResponse) {
			const item = Option.getOrUndefined(
				Schema.decodeUnknownOption(Notification)(response.notification.request.content.data)
			)
			if (item === undefined) return
			clearLastNotificationResponse()
			Queue.offerUnsafe(queue, Message.Opened({route: flightRoute(item.flightId)}))
			if (item.place === undefined) return
			if (response.actionIdentifier === 'directions') {
				Queue.offerUnsafe(queue, Message.OpenUrl({url: directionsTo(item.place)}))
			}
			if (response.actionIdentifier === 'uber') {
				Option.map(rideTo(item.place), url => Queue.offerUnsafe(queue, Message.OpenUrl({url})))
			}
		}
		yield* listen(() => addNotificationResponseReceivedListener(responded))
		const initial = getLastNotificationResponse()
		if (initial !== null) responded(initial)
	})
)
