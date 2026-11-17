import {
	Array,
	Boolean,
	Cause,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	Layer,
	Option,
	Result,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	Struct,
	pipe
} from 'effect'

import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Apns, apnsAccepted, apnsDeadToken, apnsRetryable} from '@deslop/runtime/server/apns'

import {
	ACTIVITY_NAME,
	activeWindow,
	journeyProps,
	journeysOf,
	startable,
	urgencyOf
} from '#services/bookings/lib/utils.ts'
import type {ActivityProps, BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import {Booking, BookingId} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {alertsOf, announced, expiredActivities, holds, showPlan, startAlert} from '#services/push/lib/utils.ts'
import type {Alert} from '#services/push/lib/utils.ts'
import {
	Activity,
	ActivityPropsJson,
	ChannelId,
	Device,
	PushError,
	SentAlert,
	ShowAction,
	StartRequest
} from '#services/push/schema.ts'

const SCHEMES = {'xyz.mp281x.trips': 'trips', 'xyz.mp281x.trips.dev': 'trips-dev'}

type Span = {end: DateTime.Utc; start: DateTime.Utc}
type Showing = {journey: Flight | Train; leg: Leg; now: DateTime.Utc; props: ActivityProps; window: Span}
type RoundState = {activities: readonly Activity[]; devices: readonly Device[]; sent: readonly SentAlert[]}

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly push: never
	}
}

function seconds(time: DateTime.Utc) {
	return DateTime.toEpochSeconds(time)
}

function asPushError(message: string) {
	return Effect.mapError((cause: unknown) => PushError.make({cause, message}))
}

// The activity's columns an update writes, to change only some of them.
function editable(activity: Activity) {
	return Struct.pick(activity, Struct.keys(Activity.update.fields))
}

const contentState = Effect.fnUntraced(function* (props: ActivityProps) {
	return {name: ACTIVITY_NAME, props: yield* Schema.encodeEffect(ActivityPropsJson)(props)}
})

// Trips owns notification and Live Activity policy; the runtime owns Apple's transport.
export class Push extends Context.Service<Push>()('@deslop/trips/services/push/service/Push', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const bookings = yield* Bookings
		const apns = yield* Apns
		// Writes tell this Reactivity of their commits, so callers need none of their own.
		const withReactivity = Effect.provideService(Reactivity.Reactivity, yield* Reactivity.Reactivity)

		const activities = yield* SqlModel.makeRepository(Activity, {
			idColumn: 'channel',
			spanPrefix: 'Activities',
			tableName: Activity.table
		})
		const listActivities = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Activity,
			execute: () => sql`SELECT * FROM ${sql(Activity.table)}`
		})
		// A started activity replaces any earlier one of its leg on its app.
		const startActivity = SqlSchema.void({
			Request: Activity.insert,
			execute: row => sql`INSERT OR REPLACE INTO ${sql(Activity.table)} ${sql.insert(row)}`
		})
		const forgetEndedBefore = SqlSchema.void({
			Request: Schema.DateTimeUtcFromMillis,
			execute: time => sql`DELETE FROM ${sql(Activity.table)} WHERE endedAt < ${time}`
		})
		const listDevices = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Device,
			execute: () => sql`SELECT * FROM ${sql(Device.table)}`
		})
		const saveDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`
				INSERT INTO ${sql(Device.table)} ${sql.insert(row)}
				ON CONFLICT (bundle, kind) DO UPDATE SET token = excluded.token
			`
		})
		// Only while the token is still the one stored, so a token rotated meanwhile stays.
		const forgetDevice = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`
				DELETE FROM ${sql(Device.table)}
				WHERE bundle = ${row.bundle} AND kind = ${row.kind} AND token = ${row.token}
			`
		})
		const listSent = SqlSchema.findAll({
			Request: Schema.Void,
			Result: SentAlert,
			execute: () => sql`SELECT * FROM ${sql(SentAlert.table)} ORDER BY sentAt`
		})
		const recordSent = SqlSchema.void({
			Request: Schema.NonEmptyArray(SentAlert.insert),
			execute: rows => sql`
				INSERT INTO ${sql(SentAlert.table)} ${sql.insert(rows)}
				ON CONFLICT DO UPDATE SET sentAt = excluded.sentAt
			`
		})
		const forgetSentExcept = SqlSchema.void({
			Request: Schema.Array(BookingId),
			execute: ids => sql`DELETE FROM ${sql(SentAlert.table)} WHERE bookingId NOT IN ${sql.in(ids)}`
		})

		const asPushReadError = asPushError('The push state could not be read.')
		const asPushSaveError = asPushError('The push state could not be saved.')
		const roundState = Effect.gen(function* () {
			return {
				activities: yield* asPushReadError(listActivities()),
				devices: yield* asPushReadError(listDevices()),
				sent: yield* asPushReadError(listSent())
			} satisfies RoundState
		})
		const listRequests = SqlSchema.findAll({
			Request: Schema.Void,
			Result: StartRequest,
			execute: () => sql`SELECT * FROM ${sql(StartRequest.table)}`
		})
		const recordRequest = SqlSchema.void({
			Request: StartRequest.insert,
			execute: row =>
				sql`INSERT INTO ${sql(StartRequest.table)} ${sql.insert(row)} ON CONFLICT (bookingId) DO UPDATE SET at = excluded.at`
		})

		const pushStart = Effect.fnUntraced(function* (target: Device, showing: Showing) {
			const answer = yield* apns.startActivity(target, showing.leg, {
				aps: {
					alert: startAlert(showing.journey),
					attributes: {url: `${SCHEMES[target.bundle]}://booking/${showing.journey.id}`},
					'attributes-type': 'LiveActivityAttributes',
					'content-state': yield* contentState(showing.props),
					event: 'start',
					'relevance-score': 100,
					timestamp: seconds(showing.now)
				}
			})
			if (apnsAccepted(answer)) return Result.succeed(ChannelId.make(Option.getOrThrow(answer.channel)))
			if (!apnsRetryable(answer)) yield* pipe(forgetDevice(target), Reactivity.mutation(['push']), asPushSaveError)
			return Result.fail(answer)
		})

		// A refused start leaves the leg unstarted, so the next round tries again.
		const launch = Effect.fnUntraced(function* (target: Device, showing: Showing) {
			const started = yield* pushStart(target, showing)
			if (Result.isFailure(started)) {
				return yield* PushError.make({cause: started.failure, message: 'Apple did not accept the Live Activity start.'})
			}
			yield* pipe(
				startActivity({
					bookingId: showing.journey.id,
					bundle: target.bundle,
					channel: started.success,
					endedAt: Option.none(),
					leg: showing.leg,
					props: showing.props,
					startedAt: showing.now
				}),
				Reactivity.mutation(['push']),
				asPushSaveError
			)
		})

		const finish = Effect.fnUntraced(function* (activity: Activity, now: DateTime.Utc) {
			const answer = yield* apns.broadcast(
				activity.bundle,
				activity.channel,
				{
					'content-state': yield* contentState(activity.props),
					'dismissal-date': seconds(DateTime.addDuration(now, Duration.minutes(10))),
					event: 'end',
					timestamp: seconds(now)
				},
				10,
				now
			)
			if (apnsRetryable(answer)) {
				return yield* PushError.make({cause: answer, message: 'Apple did not accept the Live Activity end.'})
			}
			yield* apns.deleteChannel(activity.bundle, activity.channel)
			yield* pipe(
				activities.updateVoid({...editable(activity), endedAt: Option.some(now)}),
				Reactivity.mutation(['push']),
				asPushSaveError
			)
		})

		// A change APNs took or will always refuse is remembered; a throttled one is sent again next round.
		const refresh = Effect.fnUntraced(function* (activity: Activity, props: ActivityProps, now: DateTime.Utc) {
			const shown = yield* contentState(activity.props)
			const next = yield* contentState(props)
			if (next.props === shown.props) return
			const answer = yield* apns.broadcast(
				activity.bundle,
				activity.channel,
				{'content-state': next, event: 'update', timestamp: seconds(now)},
				Boolean.match(urgencyOf(activity.props) === urgencyOf(props), {
					onFalse: Function.constant(10 as const),
					onTrue: Function.constant(5 as const)
				}),
				now
			)
			if (apnsRetryable(answer)) {
				return yield* PushError.make({cause: answer, message: 'Apple did not accept the Live Activity update.'})
			}
			// A refused channel means the activity is gone.
			yield* pipe(
				activities.updateVoid(
					Boolean.match(apnsDeadToken(answer), {
						onFalse: () => ({...editable(activity), props}),
						onTrue: () => ({...editable(activity), endedAt: Option.some(now)})
					})
				),
				Reactivity.mutation(['push']),
				asPushSaveError
			)
		})

		const show = Effect.fnUntraced(function* (
			journey: Flight | Train,
			window: Span & {leg: Leg},
			all: BookingList,
			now: DateTime.Utc,
			legs: readonly (Flight | Train)[],
			requested: Option.Option<DateTime.Utc>,
			state: RoundState
		) {
			const showing = {journey, leg: window.leg, now, props: journeyProps(legs, all, now), window} satisfies Showing
			// An activity that cannot cover the window ends, and the leg starts afresh.
			const ended = yield* pipe(
				state.activities,
				Array.filter(
					activity =>
						activity.bookingId === journey.id &&
						activity.leg === window.leg &&
						Option.isNone(activity.endedAt) &&
						!holds(activity, window)
				),
				Effect.forEach(activity => Effect.result(finish(activity, now)), {concurrency: 1})
			)
			const outcomes = yield* Effect.forEach(
				showPlan(state.devices, state.activities, journey, window, requested),
				action => {
					if (ShowAction.guards.launch(action)) return Effect.result(launch(action.target, showing))
					return Effect.result(refresh(action.target, showing.props, now))
				},
				{concurrency: 1}
			)
			yield* Option.match(Array.head([...Array.getFailures(ended), ...Array.getFailures(outcomes)]), {
				onNone: () => Effect.void,
				onSome: Effect.fail
			})
		})

		// A device whose token died leaves the list with its first failed alert.
		const notify = Effect.fnUntraced(function* (device: Device, alert: Alert, booking: Booking) {
			const answer = yield* apns.sendToDevice(
				device,
				'alert',
				{
					aps: {alert: {body: alert.body, title: alert.title}, sound: 'default', 'thread-id': booking.id},
					bookingId: booking.id
				},
				10
			)
			if (apnsAccepted(answer)) return 'accepted' as const
			if (apnsRetryable(answer)) return 'retry' as const
			if (!apnsDeadToken(answer)) return 'refused' as const
			yield* pipe(forgetDevice(device), Reactivity.mutation(['push']), asPushSaveError)
			return 'dead' as const
		})

		const announce = Effect.fnUntraced(function* (booking: Booking, now: DateTime.Utc, state: RoundState) {
			const sent = Array.filter(state.sent, alert => alert.bookingId === booking.id)
			const fresh = Array.filter(alertsOf(booking, now), alert => !announced(sent, alert))
			if (Array.isReadonlyArrayEmpty(fresh)) return
			const devices = Array.filter(state.devices, device => device.kind === 'alert')
			// An alert every device refused for now, such as a throttled one, is sent again next round.
			const done = yield* Effect.filter(
				fresh,
				alert =>
					pipe(
						devices,
						Effect.forEach(
							device =>
								Effect.catch(notify(device, alert, booking), cause =>
									Effect.as(Effect.logWarning('An alert was not sent', Cause.fail(cause)), 'retry' as const)
								),
							{concurrency: 1}
						),
						Effect.map(
							outcomes =>
								!Array.isReadonlyArrayNonEmpty(outcomes) || !Array.every(outcomes, outcome => outcome === 'retry')
						)
					),
				{concurrency: 1}
			)
			yield* Array.match(done, {
				onEmpty: () => Effect.void,
				onNonEmpty: alerts =>
					pipe(
						recordSent(
							Array.map(alerts, alert => ({
								bookingId: booking.id,
								category: alert.category,
								sentAt: now,
								value: Option.fromUndefinedOr(alert.value)
							}))
						),
						Reactivity.mutation(['push']),
						asPushSaveError
					)
			})
		})

		const ticking = yield* Semaphore.make(1)
		const tick = pipe(
			Effect.gen(function* () {
				if (!apns.enabled) return
				const now = yield* DateTime.now
				const all = yield* bookings.list
				const state = yield* roundState
				const requests = yield* asPushReadError(listRequests())
				const requestsById = Array.groupBy(requests, request => request.bookingId)
				yield* Effect.forEach(
					journeysOf(all),
					journey => {
						const booking = journey[0]
						const legs = Array.filter(journey, (leg): leg is Flight | Train => !Booking.isAnyOf(['stay'])(leg))
						const requested = Option.map(Array.head(requestsById[booking.id] ?? []), request => request.at)
						return Effect.ignore(
							Effect.gen(function* () {
								yield* Effect.forEach(
									journey,
									leg =>
										Effect.ignore(announce(leg, now, state), {
											log: 'Warn',
											message: `The alerts of ${leg.id} were not sent`
										}),
									{concurrency: 1, discard: true}
								)
								if (Booking.isAnyOf(['stay'])(booking)) return
								yield* Option.match(activeWindow(booking, now, legs, requested), {
									onNone: () => Effect.void,
									onSome: window => show(booking, window, all, now, legs, requested, state)
								})
							}),
							{log: 'Warn', message: `The Live Activity of ${booking.id} was not updated`}
						)
					},
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					expiredActivities(state.activities, all, now, requests),
					activity => Effect.ignore(finish(activity, now), {log: 'Warn', message: 'An activity was not ended'}),
					{concurrency: 1, discard: true}
				)
				// Nothing reads an activity two days after it ended, or the alerts of a booking that left.
				yield* pipe(
					Effect.andThen(
						forgetEndedBefore(DateTime.subtractDuration(now, Duration.days(2))),
						forgetSentExcept(Array.map(all, booking => booking.id))
					),
					Reactivity.mutation(['push']),
					sql.withTransaction,
					asPushSaveError
				)
			}),
			Semaphore.withPermit(ticking),
			Effect.withSpan('Push.round'),
			Effect.ignore({log: 'Warn', message: 'The push round failed'})
		)

		yield* pipe(tick, Effect.repeat(Schedule.spaced('30 seconds')), Effect.forkScoped)
		yield* Effect.forkScoped(
			pipe(
				bookings.watch,
				Stream.debounce('2 seconds'),
				Stream.runForEach(() => tick),
				Effect.ignore({log: 'Warn', message: 'The bookings stopped reaching the push rounds'})
			)
		)

		return {
			register: Effect.fn('Push.register')(function* (device: typeof Device.insert.Type) {
				yield* pipe(saveDevice(device), Reactivity.mutation(['push']), asPushSaveError)
			}, withReactivity),
			start: Effect.fn('Push.start')(
				function* (id: BookingId) {
					if (!apns.enabled) return yield* PushError.make({message: 'The server has no Apple push configuration.'})
					const all = yield* asPushError('The bookings could not be read.')(bookings.list)
					const journey = Array.findFirst(journeysOf(all), group => Array.some(group, leg => leg.id === id))
					const now = yield* DateTime.now
					const legs = pipe(
						journey,
						Option.toArray,
						Array.flatten,
						Array.filter((leg): leg is Flight | Train => !Booking.isAnyOf(['stay'])(leg))
					)
					if (!startable(legs, now)) return yield* PushError.make({message: 'This journey cannot be started now.'})
					yield* asPushSaveError(recordRequest({at: now, bookingId: Option.getOrThrow(Array.head(legs)).id}))
					const booking = Option.getOrThrow(Array.head(legs))
					const window = yield* Option.match(activeWindow(booking, now, legs, Option.some(now)), {
						onNone: () => PushError.make({message: 'This journey has no Live Activity window.'}),
						onSome: Effect.succeed
					})
					const state = yield* roundState
					if (
						Array.isReadonlyArrayEmpty(showPlan(state.devices, state.activities, booking, window, Option.some(now)))
					) {
						return yield* PushError.make({message: 'No registered device can start this Live Activity.'})
					}
					yield* asPushError('The Live Activity could not be started.')(
						show(booking, window, all, now, legs, Option.some(now), state)
					)
				},
				Semaphore.withPermit(ticking),
				withReactivity
			)
		}
	})
}) {
	// The tables this service owns, made and changed at start in one transaction; one statement per `sql` call, since SQLite runs only the first statement of a string.
	static readonly migrations = Layer.effectDiscard(
		Migrator.make({})({
			loader: Migrator.fromRecord({
				'0001_push': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`
						CREATE TABLE devices (
							bundle TEXT NOT NULL,
							kind TEXT NOT NULL,
							token TEXT NOT NULL,
							PRIMARY KEY (bundle, kind)
						) STRICT, WITHOUT ROWID
					`
					// A channel is one activity's: every update and its end go through it.
					yield* sql`
						CREATE TABLE activities (
							channel TEXT PRIMARY KEY,
							bookingId TEXT NOT NULL,
							leg TEXT NOT NULL,
							bundle TEXT NOT NULL,
							startedAt INTEGER NOT NULL,
							endedAt INTEGER,
							props TEXT NOT NULL,
							UNIQUE (bookingId, leg, bundle)
						) STRICT
					`
					yield* sql`
						CREATE TABLE sent_alerts (
							bookingId TEXT NOT NULL,
							key TEXT NOT NULL,
							sentAt INTEGER NOT NULL,
							PRIMARY KEY (bookingId, key)
						) STRICT, WITHOUT ROWID
					`
				}),
				'0002_alert_records': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`ALTER TABLE sent_alerts RENAME TO packed_alerts`
					yield* sql`CREATE TABLE sent_alerts (bookingId TEXT NOT NULL, category TEXT NOT NULL, value TEXT, sentAt INTEGER NOT NULL) STRICT`
					yield* sql`INSERT INTO sent_alerts (bookingId, category, value, sentAt) SELECT bookingId, CASE WHEN instr(key, ':') = 0 THEN key ELSE substr(key, 1, instr(key, ':') - 1) END, CASE WHEN instr(key, ':') = 0 THEN NULL ELSE substr(key, instr(key, ':') + 1) END, sentAt FROM packed_alerts`
					yield* sql`DROP TABLE packed_alerts`
					yield* sql`CREATE UNIQUE INDEX alert_value ON sent_alerts (bookingId, category, value) WHERE value IS NOT NULL`
					yield* sql`CREATE UNIQUE INDEX alert_once ON sent_alerts (bookingId, category) WHERE value IS NULL`
				}),
				'0003_requests': Effect.gen(function* () {
					yield* (yield* SqlClient.SqlClient)`CREATE TABLE requests (bookingId TEXT PRIMARY KEY, at INTEGER NOT NULL) STRICT, WITHOUT ROWID`
				})
			}),
			table: 'push_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
