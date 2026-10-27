import {
	Array,
	Boolean,
	DateTime,
	Effect,
	FiberHandle,
	HashSet,
	Layer,
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

import {FetchHttpClient} from 'effect/http'
import {AsyncResult, AtomRpc, Atom} from 'effect/reactivity'
import * as Application from 'expo-application'
import * as Calendar from 'expo-calendar'
import {File, Paths} from 'expo-file-system'
import * as Location from 'expo-location'
import * as Notifications from 'expo-notifications'
import * as SecureStore from 'expo-secure-store'
import {addPushToStartTokenListener} from 'expo-widgets'
import type {LiveActivity} from 'expo-widgets'
import {DynamicColorIOS, Linking} from 'react-native'

import {colors} from '@deslop/components-mobile/theme'
import {alert, writeAtomically} from '@deslop/components-mobile/utils'
import {RpcAuth} from '@deslop/runtime/auth/utils'
import * as MobileRuntime from '@deslop/runtime/mobile'
import * as MobileSession from '@deslop/runtime/mobile/session'

import {JourneyActivity} from '#lib/activities.tsx'
import {RpcContracts} from '#rpcs/contracts.ts'
import {
	activeWindow,
	activityProps,
	arrivalOf,
	byStart,
	departureOf,
	endOf,
	HOUR,
	isStale,
	labelled,
	MINUTE,
	stayAfter,
	titleOf
} from '#services/bookings/lib/utils.ts'
import type {
	ActivityProps,
	Booking,
	BookingsEvent,
	Flight,
	Place,
	Stay,
	Tone,
	Train
} from '#services/bookings/schema.ts'
import {BookingList, BookingsError, Leg} from '#services/bookings/schema.ts'
import {ApnsEnvironment, Bundle} from '#services/push/schema.ts'

const SERVER = 'https://trips.mp281x.xyz'
const SESSION = 'session'
const CALENDAR = 'Trips'

// Auth

export const session = MobileSession.make('Trips', SERVER, {
	clear: Effect.tryPromise(() => SecureStore.deleteItemAsync(SESSION)),
	read: Effect.try(() => SecureStore.getItem(SESSION) ?? ''),
	// Readable from the first unlock after a restart, so a socket that reconnects while the iPhone is locked finds it.
	write: text =>
		Effect.try(() => SecureStore.setItem(SESSION, text, {keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK}))
})

export const signInAtom = session.runtime.fn(() => pipe(session.signIn, alert('Not Signed In')))

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/trips/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: pipe(
		MobileRuntime.layer('@deslop/trips', session.accessToken)(SERVER),
		Layer.provideMerge(RpcAuth.layerClient(session.accessToken)),
		Layer.provide(FetchHttpClient.layer)
	)
}) {}

// Actions read the client once rather than rerunning their last write when it reconnects.
function withClient<A, E>(get: Atom.FnContext, effect: Effect.Effect<A, E, RpcClient>) {
	return Effect.flatMap(get.result(RpcClient.runtime), context => Effect.provideContext(effect, context))
}

// The link an island, a calendar event or the server's pushes open.
function linkOf(bookingId: string) {
	return `${MobileRuntime.extra.scheme}://booking/${bookingId}`
}

// Bookings

type BookingsJson = typeof BookingsJson.Type
const BookingsJson = Schema.fromJsonString(BookingList)
const bookingsFile = new File(Paths.document, 'bookings.json')

function apply(bookings: BookingList, event: BookingsEvent) {
	if (event.reset) return Array.sort(event.upserted, byStart)
	const replaced = HashSet.fromIterable([...event.removed, ...Array.map(event.upserted, booking => booking.id)])
	return Array.sort(
		[...Array.filter(bookings, booking => !HashSet.has(replaced, booking.id)), ...event.upserted],
		byStart
	)
}

// The copy on the iPhone opens the trip at the gate even without a network.
export const bookingsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get => {
		if (!session.signedIn(get)) return Stream.succeed(Array.empty<Booking>())
		const shown = Option.exists(
			get.self<AsyncResult.AsyncResult<BookingList>>(),
			result => AsyncResult.isSuccess(result) && Array.isReadonlyArrayNonEmpty(result.value)
		)
		return Stream.concat(
			pipe(
				Effect.try(() => bookingsFile.textSync()),
				Effect.flatMap(Schema.decodeEffect(BookingsJson)),
				Effect.option,
				Stream.fromEffect,
				Stream.flatMap(cached => Stream.fromIterable(Option.toArray(cached))),
				Stream.when(Effect.succeed(!shown))
			),
			pipe(
				Effect.gen(function* () {
					const writes = yield* FiberHandle.make()
					return pipe(
						(yield* RpcClient)('bookings.watch', undefined),
						Stream.scan(Array.empty<Booking>, apply),
						Stream.drop(1),
						Stream.tap(bookings =>
							FiberHandle.run(
								writes,
								pipe(
									Schema.encodeEffect(BookingsJson)(bookings),
									Effect.flatMap(json => Effect.try(() => writeAtomically(bookingsFile, json))),
									Effect.delay('2 seconds'),
									Effect.ignore({log: 'Warn', message: 'The bookings could not be kept on this iPhone'})
								)
							)
						)
					)
				}),
				Stream.unwrap,
				session.renewing
			)
		)
	})
)

const draftFile = new File(Paths.document, 'draft.txt')

// The pasted text survives leaving the sheet, switching apps and an update, until it is saved.
export const draftAtom = Atom.writable(
	() => Boolean.match(draftFile.exists, {onFalse: () => '', onTrue: () => draftFile.textSync()}),
	(context, text: string) => {
		writeAtomically(draftFile, text)
		context.setSelf(text)
	}
)

export const saveAtom = Atom.keepAlive(
	Atom.fn((text: string, get) =>
		pipe(
			withClient(
				get,
				Effect.flatMap(RpcClient, client => client('bookings.save', {text: String.trim(text)}))
			),
			// Text typed since this save started stays.
			Effect.tap(() =>
				Effect.sync(() => {
					if (get(draftAtom) === text) get.set(draftAtom, '')
				})
			),
			alert('Not Saved')
		)
	)
)

// The booking deleted last, which the list offers to put back for a few seconds.
export const deletedAtom = Atom.keepAlive(Atom.make(Option.none<Booking>()))

export const removeAtom = Atom.keepAlive(
	Atom.fn(
		(booking: Booking, get) =>
			pipe(
				withClient(
					get,
					Effect.flatMap(RpcClient, client => client('bookings.remove', {id: booking.id}))
				),
				Effect.tap(() => Effect.sync(() => get.set(deletedAtom, Option.some(booking)))),
				alert('Not Deleted'),
				Effect.andThen(Effect.sleep('8 seconds')),
				Effect.andThen(
					Effect.sync(() => {
						if (Option.exists(get(deletedAtom), found => found === booking)) get.set(deletedAtom, Option.none())
					})
				)
			),
		// Each delete keeps its own offer; a later one does not interrupt it.
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
			Effect.tap(() =>
				Effect.sync(() => {
					if (Option.exists(get(deletedAtom), found => found === booking)) get.set(deletedAtom, Option.none())
				})
			),
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

// The time the screens read: a minute at a time, and again on each return to the app.
export const nowAtom = Atom.make(get => {
	get(MobileRuntime.activationsAtom)
	return Stream.map(Stream.tick('1 minute'), () => DateTime.toEpochMillis(DateTime.nowUnsafe()))
})

// Push

const apns = Effect.gen(function* () {
	return {
		bundle: yield* Schema.decodeUnknownEffect(Bundle)(Application.applicationId),
		// The Simulator reports no environment; its tokens come from the sandbox.
		environment: Option.getOrElse(
			Schema.decodeUnknownOption(ApnsEnvironment)(
				yield* Effect.tryPromise(() => Application.getIosPushNotificationServiceEnvironmentAsync())
			),
			() => 'development' as const
		)
	}
})

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
			if ((yield* Effect.tryPromise(() => Notifications.requestPermissionsAsync())).granted) {
				yield* client('devices.register', {
					...target,
					kind: 'alert',
					token: `${(yield* Effect.tryPromise(() => Notifications.getDevicePushTokenAsync())).data}`
				})
			}
			// iOS hands out the push-to-start token and its rotations whenever it likes, for as long as the app runs.
			yield* pipe(
				Stream.callback<string>(queue =>
					Effect.acquireRelease(
						Effect.sync(() =>
							addPushToStartTokenListener(event => Queue.offerUnsafe(queue, event.activityPushToStartToken))
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

// Live Activities

type ActivityEntry = typeof ActivityEntry.Type
// The token last sent to the server, so a rotated one is sent again.
const ActivityEntry = Schema.Struct({bookingId: Schema.String, leg: Leg, token: Schema.optionalKey(Schema.String)})
type ActivityIndexJson = typeof ActivityIndexJson.Type
const ActivityIndexJson = Schema.fromJsonString(Schema.Record(Schema.String, ActivityEntry))
const activitiesFile = new File(Paths.document, 'activities.json')

type Running = ActivityEntry & {activity: LiveActivity<ActivityProps>}
type Started = [string, ActivityEntry]

function savedIndex() {
	return Option.getOrElse(
		Option.flatMap(Option.liftThrowable(() => activitiesFile.textSync())(), Schema.decodeOption(ActivityIndexJson)),
		() => Record.empty<string, ActivityEntry>()
	)
}

function writeIndex(index: ActivityIndexJson) {
	return Effect.flatMap(Schema.encodeEffect(ActivityIndexJson)(index), json =>
		Effect.try(() => writeAtomically(activitiesFile, json))
	)
}

function entryOf(bookingId: string, leg: Leg, token: Option.Option<string>) {
	return Option.match(token, {
		onNone: () => ({bookingId, leg}) satisfies ActivityEntry,
		onSome: found => ({bookingId, leg, token: found}) satisfies ActivityEntry
	})
}

// While the app is open it starts, refreshes and ends the islands itself; the server takes over with pushes once it closes.
export const activitiesAtom = RpcClient.runtime.atom(get =>
	pipe(
		Effect.gen(function* () {
			const loaded = get(bookingsAtom)
			if (!session.signedIn(get) || !AsyncResult.isSuccess(loaded)) return
			const bookings = loaded.value
			const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
			const target = yield* apns
			const client = yield* RpcClient
			const index = savedIndex()
			const running: Running[] = Array.filterMap(JourneyActivity.getInstances(), activity =>
				Option.match(Record.get(index, activity.getId()), {
					onNone: () => Result.failVoid,
					onSome: entry => Result.succeed({activity, ...entry})
				})
			)

			// Only a leg nobody started yet: the server may already show it from a push.
			const begin = Effect.fnUntraced(function* (journey: Flight | Train, leg: Leg, props: ActivityProps) {
				if (!(yield* client('activities.claim', {...target, bookingId: journey.id, leg}))) {
					return Option.none<Started>()
				}
				const activity = JourneyActivity.start(props, linkOf(journey.id))
				// Indexed at once, so a refresh interrupted while it waits for the token still finds and registers it.
				yield* writeIndex(Record.set(savedIndex(), activity.getId(), entryOf(journey.id, leg, Option.none())))
				// iOS hands a new activity its token shortly after it starts.
				const token = yield* pipe(
					Stream.merge(
						Stream.filterMap(Stream.fromEffect(Effect.tryPromise(() => activity.getPushToken())), found =>
							Result.fromNullishOr(found, () => undefined)
						),
						Stream.callback<string>(queue =>
							Effect.acquireRelease(
								Effect.sync(() => activity.addPushTokenListener(event => Queue.offerUnsafe(queue, event.pushToken))),
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
				yield* Effect.tryPromise(() => mine.activity.update(props))
				const token = yield* Effect.tryPromise(() => mine.activity.getPushToken())
				if (token === null || token === mine.token) return Option.none<Started>()
				yield* client('activities.register', {...target, bookingId: mine.bookingId, leg: mine.leg, token})
				return Option.some<Started>([mine.activity.getId(), entryOf(mine.bookingId, mine.leg, Option.some(token))])
			})

			const show = Effect.fnUntraced(function* (journey: Flight | Train, leg: Leg) {
				const props = activityProps(journey, bookings, now)
				return yield* Option.match(
					Array.findFirst(running, item => item.bookingId === journey.id && item.leg === leg),
					{onNone: () => begin(journey, leg, props), onSome: mine => refresh(mine, props)}
				)
			})

			const started = yield* Effect.forEach(
				bookings,
				booking => {
					if (booking._tag === 'stay') return Effect.succeed(Option.none<Started>())
					return Option.match(activeWindow(booking, now), {
						onNone: () => Effect.succeed(Option.none<Started>()),
						onSome: window => show(booking, window.leg)
					})
				},
				{concurrency: 1}
			)
			// An island whose leg is over or whose booking is gone ends with its last state.
			yield* Effect.forEach(
				Array.filter(
					running,
					item =>
						!Array.some(
							bookings,
							booking =>
								booking.id === item.bookingId &&
								Option.exists(activeWindow(booking, now), window => window.leg === item.leg)
						)
				),
				item => Effect.tryPromise(() => item.activity.end('default')),
				{concurrency: 1, discard: true}
			)
			// The index keeps the activities still on screen and the ones just started.
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

// Calendar

function notesOf(journey: Flight | Train) {
	const known = [labelled('Confirmation', journey.confirmation), labelled('Seat', journey.seat)]
	if (journey._tag === 'flight') return Array.join(Array.getSomes(known), '\n')
	return Array.join(Array.getSomes([...known, labelled('Coach', journey.coach)]), '\n')
}

function eventOf(booking: Booking) {
	if (booking._tag === 'stay') {
		return {
			alarms: [{relativeOffset: -3 * 60}],
			endDate: DateTime.toDateUtc(DateTime.makeUnsafe(booking.checkOut)),
			location: booking.place.address ?? booking.name,
			notes: Option.getOrElse(labelled('Confirmation', booking.confirmation), () => ''),
			startDate: DateTime.toDateUtc(DateTime.makeUnsafe(booking.checkIn)),
			timeZone: booking.place.timeZone ?? 'UTC',
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
		timeZone: booking.from.timeZone ?? 'UTC',
		title: `${titleOf(booking)} ${booking.from.code ?? booking.from.name} → ${booking.to.code ?? booking.to.name}`
	}
}

// The full name with its city, which Maps can place for Time to Leave.
export function placeLine(place: Place) {
	return Array.join(Array.filter([place.name, place.address ?? place.city ?? ''], String.isNonEmpty), ', ')
}

function sameTime(left: DateTime.DateTime.Input, right: DateTime.DateTime.Input) {
	return Option.exists(Option.all([DateTime.make(left), DateTime.make(right)]), times =>
		DateTime.Equivalence(times[0], times[1])
	)
}

// The bookings mirror into one calendar; an event's URL names its booking, so a later sync finds it again.
export const calendarAtom = Atom.make(get =>
	pipe(
		Effect.gen(function* () {
			const loaded = get(bookingsAtom)
			if (!AsyncResult.isSuccess(loaded)) return
			if (!(yield* Effect.tryPromise(() => Calendar.requestCalendarPermissions())).granted) return
			const calendar = yield* Option.match(
				Array.findFirst(
					yield* Effect.tryPromise(() => Calendar.getCalendars(Calendar.EntityTypes.EVENT)),
					found => found.title === CALENDAR
				),
				{
					onNone: () =>
						Effect.tryPromise(() => {
							const source = Calendar.getDefaultCalendarSync().source
							return Calendar.createCalendar({
								color: '#f54900',
								entityType: Calendar.EntityTypes.EVENT,
								name: CALENDAR,
								source,
								sourceId: source.id,
								title: CALENDAR
							})
						}),
					onSome: Effect.succeed
				}
			)
			const now = DateTime.toEpochMillis(DateTime.nowUnsafe())
			const events = yield* Effect.tryPromise(() =>
				calendar.listEvents(
					DateTime.toDateUtc(DateTime.makeUnsafe(now - 60 * 24 * HOUR)),
					DateTime.toDateUtc(DateTime.makeUnsafe(now + 400 * 24 * HOUR))
				)
			)
			const bookings = Array.filter(
				loaded.value,
				booking => booking.status === 'confirmed' && endOf(booking) > now - 24 * HOUR
			)
			yield* Effect.forEach(
				bookings,
				booking => {
					const details = eventOf(booking)
					return Option.match(
						Array.findFirst(events, event => event.url === linkOf(booking.id)),
						{
							onNone: () => Effect.tryPromise(() => calendar.createEvent({...details, url: linkOf(booking.id)})),
							onSome: event => {
								if (
									sameTime(event.startDate, details.startDate) &&
									sameTime(event.endDate, details.endDate) &&
									event.title === details.title &&
									event.location === details.location &&
									event.notes === details.notes
								) {
									return Effect.void
								}
								return Effect.tryPromise(() => event.update(details))
							}
						}
					)
				},
				{concurrency: 1, discard: true}
			)
			const kept = HashSet.fromIterable(Array.map(bookings, booking => linkOf(booking.id)))
			yield* Effect.forEach(
				// Only events this mirror made: one the person added to the calendar stays.
				Array.filter(
					events,
					event => event.url !== undefined && String.startsWith(linkOf(''))(event.url) && !HashSet.has(kept, event.url)
				),
				event => Effect.tryPromise(() => event.delete()),
				{concurrency: 1, discard: true}
			)
		}),
		Effect.ignore({log: 'Warn', message: 'The calendar was not synced'})
	)
)

// Rides

// Coordinates for Maps and Uber: the airport's and station's from the server, a stay's from Apple's geocoder on the iPhone.
type Coordinates = {latitude: number; longitude: number}

const coordinatesOf = Effect.fnUntraced(function* (place: Place) {
	if (place.latitude !== undefined && place.longitude !== undefined) {
		return Option.some<Coordinates>({latitude: place.latitude, longitude: place.longitude})
	}
	return Option.map(
		Array.head(yield* Effect.tryPromise(() => Location.geocodeAsync(placeLine(place)))),
		match => ({latitude: match.latitude, longitude: match.longitude}) satisfies Coordinates
	)
})

export type Ride = {label: string; place: Place}

// Where the next ride goes: the airport or station before departure, the stay after arrival.
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
			Effect.tryPromise(() =>
				Linking.openURL(
					Option.match(coordinates, {
						onNone: () => `maps://?daddr=${encodeURIComponent(placeLine(ride.place))}`,
						onSome: found => `maps://?daddr=${found.latitude},${found.longitude}&q=${encodeURIComponent(ride.label)}`
					})
				)
			)
		),
		Effect.mapError(cause => BookingsError.make({cause, message: 'Maps could not be opened.'})),
		alert('No Directions')
	)
)

export const uberAtom = Atom.fn((ride: Ride) =>
	pipe(
		coordinatesOf(ride.place),
		Effect.flatMap(Effect.fromOption),
		Effect.flatMap(found =>
			Effect.tryPromise(() =>
				Linking.openURL(
					`https://m.uber.com/ul/?action=setPickup&pickup=my_location&dropoff[latitude]=${found.latitude}&dropoff[longitude]=${found.longitude}&dropoff[nickname]=${encodeURIComponent(ride.label)}&dropoff[formatted_address]=${encodeURIComponent(placeLine(ride.place))}`
				)
			)
		),
		Effect.mapError(cause => BookingsError.make({cause, message: 'The place could not be found for Uber.'})),
		alert('No Uber')
	)
)

// Display

// "16:40" or "Tue 28 Oct" in the place's own zone, which is what the ticket and the departures board show.
export function timeAt(time: number, timeZone?: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {
		hour: '2-digit',
		hourCycle: 'h23',
		minute: '2-digit',
		timeZone: timeZone ?? 'UTC'
	})
}

export function dayAt(time: number, timeZone?: string) {
	return DateTime.format(DateTime.makeUnsafe(time), {
		day: 'numeric',
		month: 'short',
		timeZone: timeZone ?? 'UTC',
		weekday: 'short'
	})
}

// The departures board's colours, the same tones the island uses on its dark background.
export const tones = {
	bad: colors.destructive,
	good: DynamicColorIOS({dark: '#30d158', light: '#248a3d'}),
	info: DynamicColorIOS({dark: '#0a84ff', light: '#0071e3'}),
	plain: colors.mutedForeground,
	warn: DynamicColorIOS({dark: '#ffd60a', light: '#b25000'})
} satisfies Record.ReadonlyRecord<Tone, unknown>

// Where to go, the gate or platform, read beside the state and never in place of it.
type Where = {text: string; tone: Tone}

function statusLine(label: string, tone: Tone, where: Option.Option<Where>) {
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
	if (now < stay.checkIn) {
		return statusLine(`Check-in ${timeAt(stay.checkIn, stay.place.timeZone)}`, 'plain', Option.none())
	}
	if (now < stay.checkOut) return statusLine(`Out ${timeAt(stay.checkOut, stay.place.timeZone)}`, 'good', Option.none())
	return statusLine('Checked out', 'plain', Option.none())
}

// The platform to board from, then the one it arrives at once it left.
function platformOf(train: Train) {
	if (train.live?.state === 'departed' || train.live?.state === 'running' || train.live?.state === 'arrived') {
		return whereOf(labelled('Platform', train.live.arrivalPlatform), false)
	}
	return whereOf(
		labelled('Platform', train.live?.departurePlatform),
		train.live?.departurePlatformPlanned !== undefined &&
			train.live.departurePlatform !== train.live.departurePlatformPlanned
	)
}

function trainStatus(train: Train, now: number) {
	if (train.operator !== 'trenitalia') return statusLine('Timetable', 'plain', Option.none())
	if (train.live === undefined) return statusLine(timeAt(train.departs, train.from.timeZone), 'plain', Option.none())
	if (isStale(train, now)) {
		return statusLine(`Updated ${timeAt(train.live.checkedAt, train.from.timeZone)}`, 'warn', platformOf(train))
	}
	if (train.live.state === 'arrived') return statusLine('Arrived', 'plain', platformOf(train))
	if (train.live.delayMinutes >= 5) return statusLine(`+${train.live.delayMinutes} min`, 'warn', platformOf(train))
	return statusLine('On time', 'good', platformOf(train))
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
	if (state === 'cancelled') return statusLine('Cancelled', 'bad', Option.none())
	if (state === 'diverted') return statusLine('Diverted', 'bad', Option.none())
	if (flight.live === undefined) return statusLine(timeAt(flight.departs, flight.from.timeZone), 'plain', Option.none())
	if (isStale(flight, now)) {
		return statusLine(`Updated ${timeAt(flight.live.checkedAt, flight.from.timeZone)}`, 'warn', gateOf(flight))
	}
	if (state === 'arrived' || state === 'landed') {
		return statusLine('Landed', 'good', whereOf(labelled('Belt', flight.live.belt), false))
	}
	if (state === 'airborne' || state === 'departed') {
		return statusLine(`Lands ${timeAt(arrivalOf(flight), flight.to.timeZone)}`, 'info', Option.none())
	}
	if (delay >= 15) return statusLine(`+${delay} min`, 'warn', gateOf(flight))
	return statusLine('On time', 'good', gateOf(flight))
}

// Where the journey stands, with the gate or platform; old live data says when it was read rather than look current.
export function statusOf(booking: Booking, now: number) {
	if (booking.status === 'cancelled') return statusLine('Cancelled', 'bad', Option.none())
	if (booking._tag === 'stay') return stayStatus(booking, now)
	if (booking._tag === 'train') return trainStatus(booking, now)
	return flightStatus(booking, now)
}

// Navigation

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

// The booking an island, a calendar event or a notification opened, also when it launched the app.
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
								Notifications.addNotificationResponseReceivedListener(response =>
									Queue.offerUnsafe(queue, tapped(response))
								)
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
