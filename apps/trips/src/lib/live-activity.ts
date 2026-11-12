import {Array, Clock, Effect, Option, Queue, Record, Result, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {File, Paths} from 'expo-file-system'
import type {LiveActivity} from 'expo-widgets'

import {writeAtomically} from '@deslop/components-mobile/utils'

import {JourneyActivity} from '#lib/activities.tsx'
import {bookingsAtom} from '#lib/bookings.ts'
import {linkOf} from '#lib/deep-links.ts'
import {apns} from '#lib/notifications.ts'
import {RpcClient, session} from '#lib/session.ts'
import {activeWindow, activityProps} from '#services/bookings/lib/utils.ts'
import type {ActivityProps, BookingList, Flight, Train} from '#services/bookings/schema.ts'
import {BookingsError, Leg} from '#services/bookings/schema.ts'

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
			const now = yield* Clock.currentTimeMillis
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
