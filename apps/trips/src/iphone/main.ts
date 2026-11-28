import 'react-native/Libraries/Core/setUpXHR'

import {Router} from '@effect/ui'
import type {View} from '@effect/ui'
import {Native, NativeApp} from '@effect/ui-native'

import {
	Array,
	Boolean,
	Effect,
	Function,
	Layer,
	Number,
	Option,
	Predicate,
	Queue,
	Result,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Atom} from 'effect/reactivity'
import {requireNativeModule} from 'expo'
import {File, Paths} from 'expo-file-system'
import {ImageManipulator, SaveFormat} from 'expo-image-manipulator'
import type {ImageRef} from 'expo-image-manipulator'
import {
	addNotificationResponseReceivedListener,
	addPushTokenListener,
	clearLastNotificationResponse,
	getDevicePushTokenAsync,
	getLastNotificationResponse,
	requestPermissionsAsync,
	setNotificationCategoryAsync
} from 'expo-notifications'
import type {NotificationResponse} from 'expo-notifications'
import {AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, deleteItemAsync, getItemAsync, setItemAsync} from 'expo-secure-store'
import AppState from 'react-native/Libraries/AppState/AppState'
import Linking from 'react-native/Libraries/Linking/Linking'

import type {PaneLeaf} from '@deslop/components/model'
import {ListDetail, black, ink, nativeControls, status, styles} from '@deslop/components/native'
import {nativeComponents} from '@deslop/components/native/components'
import {SignOut, SignOutSession} from '@deslop/runtime/client/shell'
import {secureSession} from '@deslop/runtime/iphone/session'
import {layerIPhoneShell} from '@deslop/runtime/iphone/shell'
import {AuthError} from '@deslop/runtime/shared/auth'
import {iphoneOrigins} from '@deslop/runtime/shared/origins'
import {layerOtlp} from '@deslop/runtime/shared/telemetry'

import {TripsApp} from '#app'
import {Handset, PushPhone, TripsRoute, flightRoute, layerTrips, targetOf} from '#reads'
import type {BoardCache, Tap} from '#reads'
import {Workspace, boardSections, bookingAction, bookingSheet, flightRow} from '#view'
import type {TripsUi} from '#view'

import {FlightId, FlightsError, IMAGE_BYTES, Place, TicketSource} from '#flights/contract.ts'
import {directionsTo, rideTo} from '#flights/shared.ts'
import {PAST, heroStatus, itineraryContent} from '#itinerary/screen.ts'
import type {Hero} from '#itinerary/shared.ts'
import {keychainGroup, scheme, sessionKey, sessionService} from '#push/shared.ts'

const FIGURES = ['tabular-nums'] as const

type H = Native.H<never>
type Content = PaneLeaf<Native.NoTextInput<never>>

const origins = iphoneOrigins('trips')

if (new URL(origins.appOrigin).hostname === 'trips.mp281x.xyz') {
	Atom.runtime.addGlobalLayer(layerOtlp('@deslop/trips-ios', 'https://scope.mp281x.xyz', 'mobile', '0.1.0'))
}

const components = nativeComponents<never>()
const control = nativeControls({disabledOpacity: 0.55}).Button

// What the iPhone keeps on disk for a start without a network.
function disk(name: string) {
	function change(run: (file: File) => void) {
		return Effect.try({
			catch: cause => FlightsError.make({cause, message: 'Trips could not update its offline board'}),
			try: () => run(new File(Paths.document, name))
		})
	}
	const remove = change(file => {
		if (file.exists) file.delete()
	})
	const cache = {
		clear: Effect.ignore(remove, {log: 'Warn'}),
		read: Effect.option(
			Effect.tryPromise({
				catch: cause => FlightsError.make({cause, message: 'Trips could not read its offline board'}),
				try: () => new File(Paths.document, name).text()
			})
		),
		write: text =>
			Effect.ignore(
				change(file => {
					if (!file.exists) file.create()
					file.writeSync(text)
				}),
				{log: 'Warn'}
			)
	} satisfies BoardCache
	return {...cache, remove}
}

const accountCache = disk('account.json')
const flightCache = disk('flights.json')

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

const alerts = Stream.callback<string, FlightsError>(queue =>
	Effect.gen(function* () {
		if (!(yield* nativeCall(() => requestPermissionsAsync(), 'Notifications could not be requested.')).granted) {
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
				if (token.type === 'ios' && Predicate.isString(token.data)) Queue.offerUnsafe(queue, token.data)
			})
		)
		const token = yield* nativeCall(() => getDevicePushTokenAsync(), 'The iPhone could not register for push.')
		if (token.type === 'ios' && Predicate.isString(token.data)) yield* Queue.offer(queue, token.data)
	})
)

const starts = Stream.callback<string, FlightsError>(queue =>
	listen(() =>
		activity().addListener('activityToken', token => {
			Queue.offerUnsafe(queue, token.value)
		})
	)
)

type Payload = typeof Payload.Type
// Expo exposes the APNs userInfo.body dictionary as content.data.
const Payload = Schema.Struct({flightId: FlightId, place: Schema.optionalKey(Place)})

// A tapped notification opens its flight, and its action the way to the airport.
function tapOf(response: NotificationResponse) {
	return Option.map(Schema.decodeUnknownOption(Payload)(response.notification.request.content.data), item => {
		clearLastNotificationResponse()
		function url() {
			if (item.place === undefined) return Option.none<string>()
			if (response.actionIdentifier === 'directions') return Option.some(directionsTo(item.place))
			if (response.actionIdentifier === 'uber') return rideTo(item.place)
			return Option.none<string>()
		}
		return {route: flightRoute(item.flightId), url: url()} satisfies Tap
	})
}

const notifications = Stream.callback<Tap>(queue =>
	Effect.gen(function* () {
		yield* listen(() =>
			addNotificationResponseReceivedListener(response => {
				Option.map(tapOf(response), tap => Queue.offerUnsafe(queue, tap))
			})
		)
		const initial = getLastNotificationResponse()
		if (initial !== null) Option.map(tapOf(initial), tap => Queue.offerUnsafe(queue, tap))
	})
)

const activation = Stream.callback<void>(queue =>
	listen(() =>
		AppState.addEventListener('change', state => {
			if (state === 'active') Queue.offerUnsafe(queue, undefined)
		})
	)
)

function readImage<A>(run: () => PromiseLike<A>) {
	return Effect.tryPromise({
		catch: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
		try: run
	})
}

// Match the web picker: at most 1800 px on the long side.
function fitted(source: ImageRef) {
	if (Number.max(source.width, source.height) <= 1800) return Effect.succeed(source)
	const size = Boolean.match(source.width >= source.height, {
		onFalse: () => ({height: 1800}),
		onTrue: () => ({width: 1800})
	})
	return readImage(() => ImageManipulator.manipulate(source).resize(size).renderAsync())
}

const bookingJpeg = Effect.fnUntraced(function* (file: File) {
	const image = yield* fitted(yield* readImage(() => ImageManipulator.manipulate(file.uri).renderAsync()))
	const jpeg = yield* readImage(() => image.saveAsync({compress: 0.88, format: SaveFormat.JPEG}))
	return yield* readImage(() => new File(jpeg.uri).bytes())
})

const chooseTicket = Effect.gen(function* () {
	const picked = yield* Effect.tryPromise({
		catch: cause => FlightsError.make({cause, message: 'The booking file could not be opened.'}),
		try: () => File.pickFileAsync({mimeTypes: ['image/*', 'application/pdf']})
	})
	if (picked.canceled) return Option.none<TicketSource>()
	const file = picked.result
	if (file.size === 0 || file.size > IMAGE_BYTES) {
		return yield* FlightsError.make({message: 'Choose an image or PDF up to 4 MB.'})
	}
	if (file.type === 'application/pdf') {
		const pdf = yield* Effect.tryPromise({
			catch: cause => FlightsError.make({cause, message: 'The booking PDF could not be read.'}),
			try: () => file.bytes()
		})
		return Option.some(TicketSource.cases.pdf.make({pdf}))
	}
	return yield* pipe(
		bookingJpeg(file),
		Effect.flatMap(image => TicketSource.cases.image.makeEffect({image})),
		Effect.mapBoth({
			onFailure: cause => FlightsError.make({cause, message: 'The booking image could not be read.'}),
			onSuccess: Option.some
		})
	)
})

function date(h: H, title: string) {
	return h.text
		.style({...styles.line, fontWeight: '600', paddingBottom: 4, paddingHorizontal: 12, paddingTop: 12})
		.children(title)
}

function figure(h: H, hero: Hero, note?: string, inset = 0) {
	const problem = heroStatus(hero)
	const was = Option.getOrUndefined(hero.was)
	return h.view
		.style({paddingBottom: 20, paddingHorizontal: inset, paddingTop: 12})
		.children(
			h.view
				.style(styles.titleLine)
				.children(
					problem !== undefined && h.view.style({...styles.dot, backgroundColor: status[problem]}),
					h.text.style(styles.line).children(hero.label)
				),
			h.view
				.style({alignItems: 'baseline', flexDirection: 'row', flexWrap: 'wrap', gap: 8})
				.children(
					h.text
						.style({
							...styles.heading,
							fontSize: 34,
							fontVariant: FIGURES,
							lineHeight: 40,
							opacity: Boolean.match(hero.pending, {onFalse: Function.constant(1), onTrue: Function.constant(0.55)})
						})
						.children(hero.value),
					was !== undefined &&
						h.text.style({...styles.line, fontVariant: FIGURES, textDecorationLine: 'line-through'}).children(was),
					h.text.style({...styles.line, flex: 1, textAlign: 'right'}).children(hero.right)
				),
			note !== undefined && h.text.style(styles.line).children(note)
		)
}

const drawing: TripsUi<H, Content, View.Content<never>> = {
	...components,
	banner: (h, banner) =>
		h.view
			.style({alignItems: 'flex-start', padding: 16})
			.children(
				h.text.style(styles.body).children(banner.message),
				control(h, banner.action(banner.action(h.view, 'press'), 'accessibilityTap'), banner.label, banner.pending)
			),
	board: (h, screen, details) =>
		h.view.children(
			h.text.style({...styles.line, fontFamily: 'ui-monospace', fontVariant: FIGURES}).children(details.context),
			figure(h, details.hero, details.note),
			...boardSections(h, drawing, screen, details)
		),
	boardSkeleton: h => {
		function block(width: Native.ViewStyle['width'], height: number) {
			return h.view.style({backgroundColor: '#202020', borderRadius: 4, height, width})
		}
		return h.view.prop('accessibilityLabel', 'Loading boarding pass').children(
			block('44%', 10),
			h.view.style({gap: 8, paddingVertical: 20}).children(block(35, 10), block(72, 25)),
			Array.makeBy(3, index =>
				h.view
					.key(`skeleton-${index}`)
					.style({gap: 6, height: 54, justifyContent: 'center'})
					.children(block(64, 12), block(112, 10))
			)
		)
	},
	booking: (h, screen) => {
		const cancel = screen.cancel(screen.cancel(h.view, 'press'), 'accessibilityTap')
		const submit = screen.submit(screen.submit(h.view, 'press'), 'accessibilityTap')
		const choose = screen.choose(screen.choose(h.view, 'press'), 'accessibilityTap')
		const sheet = bookingSheet<Content>(
			screen,
			h.view.style({alignItems: 'stretch', gap: 12}).children(
				h.text.style(styles.heading).children('Paste booking'),
				screen
					.text(h.input, 'input')
					.style({...styles.body, backgroundColor: black, borderRadius: 8, minHeight: 96, padding: 10})
					.prop('value', screen.pastedText)
					.prop('editable', !screen.pending)
					.prop('multiline', true)
					.prop('placeholderTextColor', styles.line.color)
					.prop('accessibilityLabel', 'Paste booking text or link')
					.prop('placeholder', 'Paste booking text or link'),
				screen.error !== undefined &&
					h.text.style(styles.body).prop('accessibilityRole', 'alert').children(screen.error),
				control(h, choose, 'Choose an image or PDF', screen.pending)
			),
			[
				control(h, cancel, 'Cancel', screen.pending),
				control(h, submit, bookingAction(screen.pending), screen.submitDisabled)
			]
		)
		return {...sheet, height: 0.6}
	},
	detailGroup: (h, title, rows) => h.view.style({marginHorizontal: -12}).children(date(h, title), rows),
	detailRows: (h, rows) => h.view.style({marginHorizontal: -12}).children(rows),
	flightTime: (h, was, current) =>
		h.view
			.style({flexDirection: 'row', gap: 6})
			.children(
				h.text.style({...styles.line, fontVariant: FIGURES, textDecorationLine: 'line-through'}).children(was),
				h.text.style({...styles.line, fontVariant: FIGURES}).children(current)
			),
	itineraryRows: (h, screen, list, wide, activeId) =>
		h.view.children(
			...itineraryContent<Content>(list, wide, activeId, {
				empty: () =>
					h.view
						.style({alignItems: 'flex-start', gap: 8, padding: 16})
						.children(
							h.text.style(styles.body).children('No upcoming flights'),
							control(h, screen.paste(screen.paste(h.view, 'press'), 'accessibilityTap'), 'Paste booking')
						),
				group: (title, hero, rows) =>
					h.view.key(title).children(date(h, title), hero !== undefined && figure(h, hero, undefined, 12), rows),
				past: row =>
					components.row(h, {
						active: false,
						item: row.item,
						select: (el, event) => screen.selection.select(el, event, PAST)
					}),
				row: (row, id) => flightRow(h, drawing, screen, row, id)
			})
		),
	missing: (h, message) => h.text.style(styles.body).children(message),
	stage: (h, options, report) =>
		h.view.style({flex: 1}).children(
			ListDetail<never, never>(h, options),
			report !== undefined &&
				h.text
					.style({
						...styles.body,
						backgroundColor: styles.control.backgroundColor,
						bottom: 16,
						color: ink,
						left: 16,
						padding: 10,
						position: 'absolute'
					})
					.prop('accessibilityRole', 'alert')
					.children(report)
		)
}

const App = TripsApp(Native.vocabulary, (h, screen) => Workspace(h, screen, drawing))

// The Trips link an iPhone follows besides its web address, which names the page right after the scheme.
function tripsLink(url: string) {
	const app = `${scheme}://`
	if (!String.startsWith(app)(url)) return Option.none()
	const path = String.slice(app.length)(url)
	return Option.some({
		followed: Effect.void,
		path: Boolean.match(String.startsWith('/')(path), {onFalse: () => `/${path}`, onTrue: () => path})
	})
}

// The iPhone keeps its account and board for a start without a network, and wipes both with the session.
const layerShell = layerIPhoneShell({
	// Auth's redirect to the page after sign-out counts, as does any success, but no other redirect.
	confirmsSignOut: code => code === 303 || (code >= 200 && code < 300),
	link: tripsLink,
	linkScheme: scheme,
	name: 'trips',
	offline: {
		clear: Effect.andThen(accountCache.clear, flightCache.clear),
		failure: 'Signed out on this iPhone, but Trips could not clear its offline data.',
		read: accountCache.read,
		wipe: Effect.map(
			Effect.all([accountCache.remove, flightCache.remove], {concurrency: 'unbounded', mode: 'result'}),
			wiped => !Array.some(wiped, Result.isFailure)
		),
		write: accountCache.write
	},
	replace: route => targetOf(route) !== undefined,
	route: TripsRoute,
	store: secureSession({deleteItemAsync, getItemAsync, setItemAsync}, AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY, sessionKey, {
		accessGroup: keychainGroup,
		keychainService: sessionService
	})
})

// The iPhone registers its tokens, opens links in Safari or the apps, and asks Auth itself to end the shared session.
const layerActions = Layer.mergeAll(
	Layer.succeed(Handset, {
		activation,
		cache: Option.some(flightCache),
		notifications,
		openUrl: url => Effect.asVoid(nativeCall(() => Linking.openURL(url), 'The link could not be opened.')),
		paste: Stream.empty,
		push: Option.some({
			alerts,
			device: Effect.flatMap(
				nativeCall(() => activity().device(), 'iOS did not name this iPhone.'),
				Schema.decodeUnknownEffect(PushPhone)
			),
			starts
		}),
		ticket: () => chooseTicket
	}),
	SignOut.toLayer(
		Effect.map(
			SignOutSession,
			signOut => () =>
				Effect.flatMap(signOut({failure: 'Could not clear the session'}), confirmed => {
					if (confirmed) return Effect.succeed(true)
					return AuthError.make({message: 'Signed out on this iPhone. Auth did not confirm signing out elsewhere.'})
				})
		)
	)
)

NativeApp.register(
	Layer.provide(
		NativeApp.mount(App, Router.props(TripsRoute)),
		Layer.provideMerge(layerTrips, Layer.provideMerge(layerActions, layerShell))
	)
)
