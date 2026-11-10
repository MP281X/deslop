import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Effect,
	HashSet,
	Layer,
	MutableList,
	Number,
	Option,
	Queue,
	Record,
	Result,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, AtomRpc, Atom} from 'effect/reactivity'
import * as Application from 'expo-application'
import * as Calendar from 'expo-calendar'
import * as Clipboard from 'expo-clipboard'
import {File, Paths} from 'expo-file-system'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import {addPushToStartTokenListener} from 'expo-widgets'
import type {LiveActivity} from 'expo-widgets'
import {Linking} from 'react-native'

import {ClipboardOffer, clipboardMachine, readClipboard} from '@deslop/components-mobile/clipboard'
import type {ClipboardKind} from '@deslop/components-mobile/clipboard'
import {colors, hues} from '@deslop/components-mobile/theme'
import {alert, cachedList, writeAtomically} from '@deslop/components-mobile/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'
import {keychain} from '@deslop/runtime/mobile/keychain'
import * as MobileSession from '@deslop/runtime/mobile/session'
import {listReducer} from '@deslop/runtime/schema'

import {JourneyActivity} from '#lib/activities.tsx'
import {RpcContracts} from '#rpcs/contracts.ts'
import {
	activeWindow,
	activityProps,
	arrivalOf,
	byStart,
	DAY,
	departureOf,
	endOf,
	HOUR,
	labelled,
	MINUTE,
	stayAfter,
	titleOf
} from '#services/bookings/lib/utils.ts'
import type {
	ActivityProps,
	Flight,
	Place,
	Stay,
	Tone,
	Train,
	BookingList,
	BookingSource
} from '#services/bookings/schema.ts'
import {Booking, BookingsError, IMAGE_BYTES, Leg} from '#services/bookings/schema.ts'
import {Bundle} from '#services/push/schema.ts'
import {isStale} from '#services/tracking/lib/utils.ts'

const CALENDAR = 'Trips'

export const session = MobileSession.make('https://trips.mp281x.xyz', keychain)

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/trips/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: session.protocol
}) {}

// Actions read the client once rather than rerunning their last write when it reconnects.
function withClient<A, E>(get: Atom.FnContext, effect: Effect.Effect<A, E, RpcClient>) {
	return Effect.flatMap(get.result(RpcClient.runtime), context => Effect.provideContext(effect, context))
}

function linkOf(bookingId: string) {
	return `${MobileRuntime.extra.scheme}://booking/${bookingId}`
}

const bookingsFile = new File(Paths.document, 'bookings.json')

const apply = listReducer(byStart)

// The copy on the iPhone opens the trip at the gate even without a network.
export const bookingsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.never
		return cachedList(
			get,
			bookingsFile,
			Booking,
			pipe(
				Stream.unwrap(Effect.map(RpcClient, client => client('bookings.watch', undefined))),
				Stream.scan(Array.empty<Booking>, apply),
				Stream.drop(1)
			),
			session.reopening
		)
	})
)

const clipboardFile = new File(Paths.document, 'clipboard.txt')
type Offer = {count: string; kind: ClipboardKind}

const bookingFromClipboard = Effect.fnUntraced(function* (offer: Offer) {
	if (offer.kind === 'image') {
		const copied = yield* Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'}),
			try: () => Clipboard.getImageAsync({format: 'jpeg', jpegQuality: 0.85})
		})
		if (copied === null) return yield* BookingsError.make({message: 'The clipboard no longer holds an image.'})
		const image = yield* pipe(
			Schema.decodeEffect(Schema.Uint8ArrayFromBase64)(String.replace(/^data:[^,]*,/u, '')(copied.data)),
			Effect.mapError(cause => BookingsError.make({cause, message: 'The copied screenshot could not be read.'}))
		)
		if (image.byteLength === 0 || image.byteLength > IMAGE_BYTES) {
			return yield* BookingsError.make({message: 'Copy a screenshot smaller than 4 MB and try again.'})
		}
		return {image} satisfies BookingSource
	}
	const text = pipe(
		yield* Effect.tryPromise({
			catch: cause => BookingsError.make({cause, message: 'The copied text could not be read.'}),
			try: () => Clipboard.getStringAsync()
		}),
		String.trim,
		String.slice(0, 60_000)
	)
	if (String.isEmpty(text)) return yield* BookingsError.make({message: 'The clipboard no longer holds text.'})
	return {text} satisfies BookingSource
})

export const clipboardAtom = AtomMachine.bind(
	Atom.runtime(get =>
		Layer.succeed(
			ClipboardOffer,
			ClipboardOffer.of({
				answer: Effect.fnUntraced(function* (answer: Offer & {save: boolean}) {
					const handled = Effect.try({
						catch: cause => BookingsError.make({cause, message: 'The answer could not be kept on this iPhone.'}),
						try: () => writeAtomically(clipboardFile, answer.count)
					})
					yield* pipe(
						Effect.gen(function* () {
							if (!answer.save) return
							const source = yield* readClipboard(answer.count, bookingFromClipboard(answer))
							yield* Effect.provideContext(
								Effect.flatMap(RpcClient, client => client('bookings.save', source)),
								yield* get.result(RpcClient.runtime)
							)
						}),
						// A refused booking is handled, but a lost connection offers the same copy on the next return.
						Effect.tapErrorTag('BookingsError', () => handled),
						Effect.andThen(handled),
						alert('Not saved'),
						Effect.ignore({log: 'Warn', message: 'The clipboard booking was not saved'})
					)
				}),
				detect: Effect.gen(function* () {
					if (yield* Effect.promise(() => Clipboard.hasImageAsync())) return Option.some<ClipboardKind>('image')
					if (yield* Effect.promise(() => Clipboard.hasStringAsync())) return Option.some<ClipboardKind>('text')
					return Option.none<ClipboardKind>()
				}),
				file: clipboardFile
			})
		)
	)
).make(clipboardMachine)

export const clipboardReturnsAtom = Atom.make(get => {
	get(MobileRuntime.activationsAtom)
	get.set(clipboardAtom.send, {_tag: 'Returned'})
})

export const undoAtom = AtomMachine.make(
	Machine.make({
		events: Machine.events({Deleted: {booking: Booking}, Restored: {id: Schema.String}}),
		root: Machine.state({states: {Idle: {}, Offered: {fields: {booking: Booking}}}}),
		timers: {expire: '8 seconds'}
	}).handle({
		initial: {target: 'Idle'},
		states: {
			Idle: {on: {Deleted: {data: transition => ({booking: transition.event.booking}), target: 'Offered'}}},
			Offered: {
				invoke: {onDone: {target: 'Idle'}, src: 'expire'},
				on: {
					Deleted: {data: transition => ({booking: transition.event.booking}), reenter: true, target: 'Offered'},
					Restored: {guard: transition => transition.state.booking.id === transition.event.id, target: 'Idle'}
				}
			}
		}
	})
)

export const removeAtom = Atom.keepAlive(
	Atom.fn(
		(booking: Booking, get) =>
			pipe(
				withClient(
					get,
					Effect.flatMap(RpcClient, client => client('bookings.remove', {id: booking.id}))
				),
				Effect.tap(() => Effect.sync(() => get.set(undoAtom.send, {_tag: 'Deleted', booking}))),
				alert('Not Deleted')
			),
		// A second swipe deletes its booking too instead of interrupting the first.
		{concurrent: true}
	)
)

export const restoreAtom = Atom.keepAlive(
	Atom.fn((booking: Booking, get) =>
		pipe(
			withClient(
				get,
				Effect.flatMap(RpcClient, client => client('bookings.restore', booking))
			),
			Effect.tap(() => Effect.sync(() => get.set(undoAtom.send, {_tag: 'Restored', id: booking.id}))),
			alert('Not Restored')
		)
	)
)

export const refreshAtom = Atom.fn((id: Booking['id'], get) =>
	pipe(
		withClient(
			get,
			Effect.flatMap(RpcClient, client => client('bookings.refresh', {id}))
		),
		// Offline the call waits for a connection, and the pull spinner would never stop.
		Effect.timeoutOrElse({
			duration: '30 seconds',
			orElse: () => BookingsError.make({message: 'The server did not answer.'})
		}),
		alert('Not Refreshed')
	)
)

export const nowAtom = Atom.make(get => {
	get(MobileRuntime.activationsAtom)
	return Stream.map(Stream.tick('1 minute'), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
})

const apns = Effect.map(Schema.decodeUnknownEffect(Bundle)(Application.applicationId), bundle => ({bundle}))

Notifications.setNotificationHandler({
	handleNotification: () =>
		// oxlint-disable-next-line eslint/no-restricted-globals -- expo-notifications' handler contract takes a Promise.
		Promise.resolve({shouldPlaySound: true, shouldSetBadge: false, shouldShowBanner: true, shouldShowList: true})
})

// Asked on the first launch: gate changes and delays reach the iPhone through these, and the server starts the island with the push-to-start token.
export const pushAtom = RpcClient.runtime.atom(get =>
	pipe(
		Effect.gen(function* () {
			if (!session.signedIn(get)) return
			const target = yield* apns
			const client = yield* RpcClient
			if (
				(yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The notification permission could not be asked.'}),
					try: () => Notifications.requestPermissionsAsync()
				})).granted
			) {
				yield* client('devices.register', {
					...target,
					kind: 'alert',
					token: `${
						(yield* Effect.tryPromise({
							catch: cause => BookingsError.make({cause, message: 'The push token could not be read.'}),
							try: () => Notifications.getDevicePushTokenAsync()
						})).data
					}`
				})
			}
			// iOS hands out the push-to-start token and its rotations whenever it likes, for as long as the app runs.
			yield* pipe(
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
				Stream.runForEach(token =>
					Effect.ignore(client('devices.register', {...target, kind: 'start', token}), {
						log: 'Warn',
						message: 'The Live Activity token was not registered'
					})
				)
			)
		}),
		Effect.ignore({log: 'Warn', message: 'Notifications are not set up on this iPhone'})
	)
)

type ActivityEntry = typeof ActivityEntry.Type
// The token last sent, so a rotated one is sent again.
const ActivityEntry = Schema.Struct({bookingId: Schema.String, leg: Leg, token: Schema.optionalKey(Schema.String)})
type ActivityIndexJson = typeof ActivityIndexJson.Type
const ActivityIndexJson = Schema.fromJsonString(Schema.Record(Schema.String, ActivityEntry))
const activitiesFile = new File(Paths.document, 'activities.json')

type Running = ActivityEntry & {activity: LiveActivity<ActivityProps>}
type Started = [string, ActivityEntry]

function savedIndex() {
	return pipe(
		Effect.try({
			catch: cause => BookingsError.make({cause, message: 'The Live Activity index could not be read.'}),
			try: () => {
				if (!activitiesFile.exists) return '{}'
				return activitiesFile.textSync()
			}
		}),
		Effect.flatMap(Schema.decodeEffect(ActivityIndexJson)),
		Effect.mapError(cause => BookingsError.make({cause, message: 'The Live Activity index could not be loaded.'}))
	)
}

function writeIndex(index: ActivityIndexJson) {
	return Effect.flatMap(Schema.encodeEffect(ActivityIndexJson)(index), json =>
		Effect.try({
			catch: cause => BookingsError.make({cause, message: 'The Live Activities could not be kept on this iPhone.'}),
			try: () => writeAtomically(activitiesFile, json)
		})
	)
}

function entryOf(bookingId: string, leg: Leg, token: Option.Option<string>) {
	return Option.match(token, {
		onNone: () => ({bookingId, leg}) satisfies ActivityEntry,
		onSome: found => ({bookingId, leg, token: found}) satisfies ActivityEntry
	})
}

function activityPlan(bookings: BookingList, running: Running[], now: number) {
	const runningByLeg = Record.map(
		Array.groupBy(running, item => item.bookingId),
		items => Array.groupBy(items, item => item.leg)
	)
	const show = Array.filterMap(bookings, booking => {
		if (booking._tag === 'stay') return Result.failVoid
		return Option.match(activeWindow(booking, now), {
			onNone: () => Result.failVoid,
			onSome: window =>
				Result.succeed({
					journey: booking,
					leg: window.leg,
					props: activityProps(booking, bookings, now),
					running: Array.head(runningByLeg[booking.id]?.[window.leg] ?? [])
				})
		})
	})
	const bookingsById = Array.groupBy(bookings, booking => booking.id)
	return {
		end: Array.filter(
			running,
			item =>
				!Array.some(bookingsById[item.bookingId] ?? [], booking =>
					Option.exists(activeWindow(booking, now), window => window.leg === item.leg)
				)
		),
		show
	}
}

// While the app is open it starts, refreshes and ends the islands itself; the server takes over with pushes once it closes.
export const activitiesAtom = RpcClient.runtime.atom(get =>
	pipe(
		Effect.gen(function* () {
			const loaded = get(bookingsAtom)
			if (!session.signedIn(get) || !AsyncResult.isSuccess(loaded)) return
			const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
			const target = yield* apns
			const client = yield* RpcClient
			const index = yield* savedIndex()
			const running: Running[] = Array.filterMap(JourneyActivity.getInstances(), activity =>
				Option.match(Record.get(index, activity.getId()), {
					onNone: () => Result.failVoid,
					onSome: entry => Result.succeed({activity, ...entry})
				})
			)
			const plan = activityPlan(loaded.value, running, now)

			// Only a leg nobody started yet: the server may already show it from a push.
			const begin = Effect.fnUntraced(function* (journey: Flight | Train, leg: Leg, props: ActivityProps) {
				if (!(yield* client('activities.claim', {...target, bookingId: journey.id, leg}))) {
					return Option.none<Started>()
				}
				const activity = JourneyActivity.start(props, linkOf(journey.id))
				// Indexed at once, so a refresh interrupted while it waits for the token still finds and registers it.
				yield* writeIndex(Record.set(yield* savedIndex(), activity.getId(), entryOf(journey.id, leg, Option.none())))
				// iOS hands a new activity its token shortly after it starts.
				const token = yield* pipe(
					Stream.merge(
						Stream.filterMap(
							Stream.fromEffect(
								Effect.tryPromise({
									catch: cause => BookingsError.make({cause, message: 'The Live Activity token could not be read.'}),
									try: () => activity.getPushToken()
								})
							),
							found => Result.fromNullishOr(found, () => undefined)
						),
						Stream.callback<string>(queue =>
							Effect.acquireRelease(
								Effect.sync(() =>
									activity.addPushTokenListener(event => {
										Queue.offerUnsafe(queue, event.pushToken)
									})
								),
								subscription => Effect.sync(() => subscription.remove())
							)
						)
					),
					Stream.runHead,
					Effect.timeout('30 seconds'),
					Effect.orElseSucceed(() => Option.none<string>())
				)
				yield* Option.match(token, {
					onNone: () => Effect.void,
					onSome: found => client('activities.register', {...target, bookingId: journey.id, leg, token: found})
				})
				return Option.some<Started>([activity.getId(), entryOf(journey.id, leg, token)])
			})

			// A running island's rotated token reaches the server on the next refresh.
			const refresh = Effect.fnUntraced(function* (mine: Running, props: ActivityProps) {
				yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The Live Activity could not be updated.'}),
					try: () => mine.activity.update(props)
				})
				const token = yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The Live Activity token could not be read.'}),
					try: () => mine.activity.getPushToken()
				})
				if (token === null || token === mine.token) return Option.none<Started>()
				yield* client('activities.register', {...target, bookingId: mine.bookingId, leg: mine.leg, token})
				return Option.some<Started>([mine.activity.getId(), entryOf(mine.bookingId, mine.leg, Option.some(token))])
			})

			const started = yield* Effect.forEach(
				plan.show,
				item =>
					Option.match(item.running, {
						onNone: () => begin(item.journey, item.leg, item.props),
						onSome: mine => refresh(mine, item.props)
					}),
				{concurrency: 1}
			)
			yield* Effect.forEach(
				plan.end,
				item =>
					Effect.tryPromise({
						catch: cause => BookingsError.make({cause, message: 'The Live Activity could not be ended.'}),
						try: () => item.activity.end('default')
					}),
				{concurrency: 1, discard: true}
			)
			yield* writeIndex({
				...Record.fromEntries(
					Array.map(
						running,
						item =>
							[item.activity.getId(), entryOf(item.bookingId, item.leg, Option.fromUndefinedOr(item.token))] as const
					)
				),
				...Record.fromEntries(Array.getSomes(started))
			})
		}),
		Effect.ignore({log: 'Warn', message: 'The Live Activities were not refreshed'})
	)
)

function notesOf(journey: Flight | Train) {
	const known = [labelled('Confirmation', journey.confirmation), labelled('Seat', journey.seat)]
	if (journey._tag === 'flight') return Array.join(Array.getSomes(known), '\n')
	return Array.join(Array.getSomes([...known, labelled('Coach', journey.coach)]), '\n')
}

export function placeLine(place: Place) {
	return Array.join(Array.filter([place.name, place.address ?? place.city ?? ''], String.isNonEmpty), ', ')
}

function eventOf(booking: Booking) {
	if (booking._tag === 'stay') {
		return {
			alarms: [{relativeOffset: -3 * 60}],
			endDate: DateTime.toDateUtc(DateTime.makeUnsafe(booking.checkOut)),
			location: booking.place.address ?? booking.name,
			notes: Option.getOrElse(labelled('Confirmation', booking.confirmation), () => ''),
			startDate: DateTime.toDateUtc(DateTime.makeUnsafe(booking.checkIn)),
			timeZone: booking.place.timeZone,
			title: booking.name
		}
	}
	return {
		// Calendar's own Time to Leave reads the location; this alert is the fallback when it is off.
		alarms: [{relativeOffset: {flight: -180, train: -45}[booking._tag]}],
		endDate: DateTime.toDateUtc(DateTime.makeUnsafe(arrivalOf(booking))),
		location: placeLine(booking.from),
		notes: notesOf(booking),
		startDate: DateTime.toDateUtc(DateTime.makeUnsafe(departureOf(booking))),
		timeZone: booking.from.timeZone,
		title: `${titleOf(booking)} ${booking.from.code ?? booking.from.name} → ${booking.to.code ?? booking.to.name}`
	}
}

function sameTime(left: DateTime.DateTime.Input, right: DateTime.DateTime.Input) {
	return Option.exists(Option.all([DateTime.make(left), DateTime.make(right)]), times =>
		DateTime.Equivalence(times[0], times[1])
	)
}

function calendarPlan(all: BookingList, events: Awaited<ReturnType<Calendar.ExpoCalendar['listEvents']>>, now: number) {
	const eventsByUrl = Array.groupBy(events, event => event.url ?? '')
	const bookings = Array.filter(all, booking => booking.status === 'confirmed' && endOf(booking) > now - 24 * HOUR)
	const create = MutableList.make<ReturnType<typeof eventOf> & {url: string}>()
	const update = MutableList.make<{event: Calendar.ExpoCalendarEvent; details: ReturnType<typeof eventOf>}>()
	for (const booking of bookings) {
		const details = {...eventOf(booking), url: linkOf(booking.id)}
		Option.match(Array.head(eventsByUrl[details.url] ?? []), {
			onNone: () => {
				MutableList.append(create, details)
			},
			onSome: event => {
				if (
					!(
						sameTime(event.startDate, details.startDate) &&
						sameTime(event.endDate, details.endDate) &&
						event.title === details.title &&
						event.location === details.location &&
						event.notes === details.notes
					)
				) {
					MutableList.append(update, {details, event})
				}
			}
		})
	}
	const kept = HashSet.fromIterable(Array.map(bookings, booking => linkOf(booking.id)))
	return {
		create: MutableList.toArray(create),
		remove: Array.filter(
			events,
			event => event.url !== undefined && String.startsWith(linkOf(''))(event.url) && !HashSet.has(kept, event.url)
		),
		update: MutableList.toArray(update)
	}
}

// The bookings mirror into one calendar; an event's URL names its booking, so a later sync finds it again.
export const calendarAtom = Atom.make(get =>
	pipe(
		Effect.gen(function* () {
			const loaded = get(bookingsAtom)
			if (!AsyncResult.isSuccess(loaded)) return
			if (
				!(yield* Effect.tryPromise({
					catch: cause => BookingsError.make({cause, message: 'The calendar permission could not be asked.'}),
					try: () => Calendar.requestCalendarPermissions()
				})).granted
			) {
				return
			}
			const calendar = yield* Option.match(
				Array.findFirst(
					yield* Effect.tryPromise({
						catch: cause => BookingsError.make({cause, message: 'The calendars could not be listed.'}),
						try: () => Calendar.getCalendars(Calendar.EntityTypes.EVENT)
					}),
					found => found.title === CALENDAR
				),
				{
					onNone: () =>
						Effect.tryPromise({
							catch: cause => BookingsError.make({cause, message: 'The Trips calendar could not be created.'}),
							try: () => {
								const source = Calendar.getDefaultCalendarSync().source
								return Calendar.createCalendar({
									color: '#4385be',
									entityType: Calendar.EntityTypes.EVENT,
									name: CALENDAR,
									source,
									sourceId: source.id,
									title: CALENDAR
								})
							}
						}),
					onSome: Effect.succeed
				}
			)
			const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
			const events = yield* Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'The calendar events could not be listed.'}),
				try: () =>
					calendar.listEvents(
						DateTime.toDateUtc(DateTime.makeUnsafe(now - 60 * 24 * HOUR)),
						DateTime.toDateUtc(DateTime.makeUnsafe(now + 400 * 24 * HOUR))
					)
			})
			const plan = calendarPlan(loaded.value, events, now)
			yield* Effect.forEach(
				plan.create,
				details =>
					Effect.tryPromise({
						catch: cause =>
							BookingsError.make({cause, message: `${details.title} could not be added to the calendar.`}),
						try: () => calendar.createEvent(details)
					}),
				{concurrency: 1, discard: true}
			)
			yield* Effect.forEach(
				plan.update,
				item =>
					Effect.tryPromise({
						catch: cause =>
							BookingsError.make({cause, message: `${item.details.title} could not be updated in the calendar.`}),
						try: () => item.event.update(item.details)
					}),
				{concurrency: 1, discard: true}
			)
			yield* Effect.forEach(
				// Only events this mirror made: one the person added to the calendar stays.
				plan.remove,
				event =>
					Effect.tryPromise({
						catch: cause =>
							BookingsError.make({cause, message: `${event.title} could not be removed from the calendar.`}),
						try: () => event.delete()
					}),
				{concurrency: 1, discard: true}
			)
		}),
		Effect.ignore({log: 'Warn', message: 'The calendar was not synced'})
	)
)

type Coordinates = {latitude: number; longitude: number}

const coordinatesOf = Effect.fnUntraced(function* (place: Place) {
	if (place.latitude !== undefined && place.longitude !== undefined) {
		return Option.some<Coordinates>({latitude: place.latitude, longitude: place.longitude})
	}
	return Option.map(
		Array.head(
			yield* Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: `${place.name} could not be found on the map.`}),
				try: () => Location.geocodeAsync(placeLine(place))
			})
		),
		match => ({latitude: match.latitude, longitude: match.longitude}) satisfies Coordinates
	)
})

export type Ride = {label: string; place: Place}

export function ridesFor(booking: Booking, bookings: BookingList, now: number) {
	if (booking._tag === 'stay') return [{label: booking.name, place: booking.place}] satisfies Ride[]
	const stay = Option.map(
		stayAfter(bookings, booking),
		found => ({label: found.name, place: found.place}) satisfies Ride
	)
	return Option.match(
		Option.filter(stay, () => now > departureOf(booking) - 30 * MINUTE),
		{
			onNone: () => [{label: booking.from.name, place: booking.from}, ...Option.toArray(stay)] satisfies Ride[],
			onSome: next => [next] satisfies Ride[]
		}
	)
}

export const mapsAtom = Atom.fn((ride: Ride) =>
	pipe(
		coordinatesOf(ride.place),
		Effect.flatMap(coordinates =>
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'Maps could not be opened.'}),
				try: () =>
					Linking.openURL(
						Option.match(coordinates, {
							onNone: () => `maps://?daddr=${encodeURIComponent(placeLine(ride.place))}`,
							onSome: found => `maps://?daddr=${found.latitude},${found.longitude}&q=${encodeURIComponent(ride.label)}`
						})
					)
			})
		),
		alert('No Directions')
	)
)

export const uberAtom = Atom.fn((ride: Ride) =>
	pipe(
		coordinatesOf(ride.place),
		Effect.flatMap(coordinates =>
			Effect.mapError(Effect.fromOption(coordinates), cause =>
				BookingsError.make({cause, message: 'The place could not be found for Uber.'})
			)
		),
		Effect.flatMap(found =>
			Effect.tryPromise({
				catch: cause => BookingsError.make({cause, message: 'Uber could not be opened.'}),
				try: () =>
					Linking.openURL(
						`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${found.latitude}&dropoff[longitude]=${found.longitude}&dropoff[nickname]=${encodeURIComponent(ride.label)}&dropoff[formatted_address]=${encodeURIComponent(placeLine(ride.place))}`
					)
			})
		),
		alert('No Uber')
	)
)

export function timeAt(time: number, timeZone: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {hour: '2-digit', hourCycle: 'h23', minute: '2-digit', timeZone})
}

export function dayAt(time: number, timeZone: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {day: 'numeric', month: 'short', timeZone, weekday: 'short'})
}

export function daysUntil(time: number, now: number, timeZone: string) {
	function day(at: number) {
		return DateTime.startOf(DateTime.makeZonedUnsafe(at, {timeZone}), 'day')
	}
	return Number.round(Duration.toMillis(DateTime.distance(day(now), day(time))) / DAY, 0)
}

export const primary = hues.orange

export const tones = {
	bad: colors.destructive,
	good: primary,
	info: primary,
	plain: colors.mutedForeground,
	warn: colors.warning
} satisfies Record.ReadonlyRecord<Tone, unknown>

export type Where = {text: string; tone: Tone}

// Only a problem's dot carries its words; a healthy status shows where it leaves from.
export type Status =
	| {label: string; tone: 'bad' | 'warn'; where: Option.Option<Where>}
	| {tone: 'good' | 'info' | 'plain'; where: Option.Option<Where>}

function statusLine(tone: 'good' | 'info' | 'plain', where: Option.Option<Where>) {
	return {tone, where}
}

function problemLine(label: string, tone: 'bad' | 'warn', where: Option.Option<Where>) {
	return {label, tone, where}
}

function whereOf(text: Option.Option<string>, changed: boolean) {
	return Option.map(
		text,
		found =>
			({text: found, tone: Boolean.match(changed, {onFalse: () => 'plain', onTrue: () => 'warn'})}) satisfies Where
	)
}

function stayStatus(stay: Stay, now: number) {
	if (now < stay.checkIn) return statusLine('plain', Option.none())
	if (now < stay.checkOut) return statusLine('good', Option.none())
	return statusLine('plain', Option.none())
}

function platformOf(train: Train) {
	if (train.live?.state === 'departed' || train.live?.state === 'arrived') {
		return whereOf(labelled('Platform', train.live.arrivalPlatform), false)
	}
	return whereOf(
		labelled('Platform', train.live?.departurePlatform),
		train.live?.departurePlatformPlanned !== undefined &&
			train.live.departurePlatform !== train.live.departurePlatformPlanned
	)
}

function trainStatus(train: Train, now: number) {
	if (train.operator !== 'trenitalia') return statusLine('plain', Option.none())
	if (train.live === undefined) return statusLine('plain', Option.none())
	if (isStale(train, now)) {
		return problemLine(`Updated ${timeAt(train.live.checkedAt, train.from.timeZone)}`, 'warn', platformOf(train))
	}
	if (train.live.state === 'arrived') return statusLine('plain', platformOf(train))
	if (train.live.delayMinutes >= 5) return problemLine(`+${train.live.delayMinutes} min`, 'warn', platformOf(train))
	return statusLine('good', platformOf(train))
}

function gateOf(flight: Flight) {
	return whereOf(
		Option.orElse(labelled('Gate', flight.live?.departureGate), () =>
			labelled('Terminal', flight.live?.departureTerminal)
		),
		flight.live?.previousGate !== undefined
	)
}

function flightStatus(flight: Flight, now: number) {
	const state = flight.live?.state
	const delay = Number.round((departureOf(flight) - flight.departs) / MINUTE, 0)
	if (state === 'cancelled') return problemLine('Cancelled', 'bad', Option.none())
	if (state === 'diverted') return problemLine('Diverted', 'bad', Option.none())
	if (flight.live === undefined) return statusLine('plain', Option.none())
	if (isStale(flight, now)) {
		return problemLine(`Updated ${timeAt(flight.live.checkedAt, flight.from.timeZone)}`, 'warn', gateOf(flight))
	}
	if (state === 'arrived' || state === 'landed') {
		return statusLine('good', whereOf(labelled('Belt', flight.live.belt), false))
	}
	if (state === 'airborne' || state === 'departed') return statusLine('info', Option.none())
	if (delay >= 15) return problemLine(`+${delay} min`, 'warn', gateOf(flight))
	return statusLine('good', gateOf(flight))
}

// Where the journey stands, with the gate or platform; old live data says when it was read rather than look current.
export function statusOf(booking: Booking, now: number) {
	if (booking.status === 'cancelled') return problemLine('Cancelled', 'bad', Option.none())
	if (booking._tag === 'stay') return stayStatus(booking, now)
	if (booking._tag === 'train') return trainStatus(booking, now)
	return flightStatus(booking, now)
}

// Only a problem gets a dot: a delay, a cancellation, or a live answer that went stale with its age.
export function problemOf(booking: Booking, status: Status, now: number) {
	if (booking._tag !== 'stay' && booking.live !== undefined && isStale(booking, now)) {
		return Option.some({
			label: `${Number.max(0, Math.floor((now - booking.live.checkedAt) / MINUTE))}m`,
			status: 'warning' as const,
			tone: 'warn' as const
		})
	}
	if (status.tone === 'bad') {
		return Option.some({label: status.label, status: 'error' as const, tone: 'bad' as const})
	}
	if (status.tone === 'warn') {
		return Option.some({label: status.label, status: 'warning' as const, tone: 'warn' as const})
	}
	return Option.none<{label: string; status: 'error' | 'warning'; tone: 'bad' | 'warn'}>()
}

function bookingIn(url?: string | null) {
	return Option.flatMap(Option.fromNullishOr(url), link =>
		Option.flatMap(String.match(/booking\/([0-9a-f-]{36})/iu)(link), match => Option.fromUndefinedOr(match[1]))
	)
}

function tapped(response: Notifications.NotificationResponse | null) {
	return Option.map(
		Schema.decodeUnknownOption(Schema.Struct({bookingId: Schema.String}))(response?.notification.request.content.data),
		data => data.bookingId
	)
}

export const openedAtom = Atom.keepAlive(
	Atom.make(
		pipe(
			Stream.merge(
				Stream.fromEffect(
					Effect.map(
						Effect.promise(() => Linking.getInitialURL()),
						url =>
							// A notification tapped while the app was closed launches it without a URL.
							Option.orElse(bookingIn(url), () => tapped(Notifications.getLastNotificationResponse()))
					)
				),
				Stream.callback<Option.Option<string>>(queue =>
					Effect.gen(function* () {
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Linking.addEventListener('url', event => Queue.offerUnsafe(queue, bookingIn(event.url)))
							),
							subscription => Effect.sync(() => subscription.remove())
						)
						yield* Effect.acquireRelease(
							Effect.sync(() =>
								Notifications.addNotificationResponseReceivedListener(response => {
									Queue.offerUnsafe(queue, tapped(response))
								})
							),
							subscription => Effect.sync(() => subscription.remove())
						)
					})
				)
			),
			Stream.flatMap(opened => Stream.fromIterable(Option.toArray(opened)))
		)
	)
)
