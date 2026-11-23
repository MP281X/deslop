import {
	Array,
	Boolean,
	Cause,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	HashSet,
	Layer,
	Option,
	Queue,
	Record,
	Ref,
	Result,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	Struct,
	pipe
} from 'effect'

import type {SqlError} from 'effect/sql'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer} from '@deslop/runtime/shared/apns'

import {ACTIVITY_NAME, journeysOf, line, stepOf} from '#services/flights/lib/utils.ts'
import type {Journey} from '#services/flights/lib/utils.ts'
import type {ActivityProps, Flight, Leg, FlightsError, TravelTime} from '#services/flights/schema.ts'
import {FlightId, Place} from '#services/flights/schema.ts'
import {Flights} from '#services/flights/service.ts'
import {
	activeWindow,
	activityPhones,
	activityProps,
	alertsOf,
	announced,
	expiredActivities,
	holds,
	perDevice,
	ridesActivity,
	ridingAlerts,
	showPlan,
	startAlert,
	unannouncedDevices,
	urgencyOf
} from '#services/push/lib/utils.ts'
import type {Alert} from '#services/push/lib/utils.ts'
import {
	Activity,
	ActivityPropsJson,
	ChannelId,
	AlertDelivery,
	Device,
	PushError,
	Retirement,
	SentAlert,
	ShowAction
} from '#services/push/schema.ts'
import {isStale} from '#services/tracking/lib/utils.ts'

const SCHEMES: Record.ReadonlyRecord<string, string> = {
	'xyz.mp281x.trips': 'trips',
	'xyz.mp281x.trips.dev': 'trips-dev'
}

// A channel written down before its start is sent was never retired, so it carries the epoch where a retired one carries the time it was; that tells it from a started channel whose end Apple took, whose activity may be gone.
const UNSTARTED = DateTime.makeUnsafe(0)

type Span = {end: DateTime.Utc; start: DateTime.Utc}
// The day an activity shows, and the flight it is at.
type Showing = {flight: Flight; journey: Journey; leg: Leg; now: DateTime.Utc; props: ActivityProps; window: Span}
// A change the activity tells as its own alert, with the flight it is about.
type Riding = {alert: Alert; flightId: FlightId}
type RoundState = {activities: readonly Activity[]; devices: readonly Device[]}

function asPushError(message: string) {
	return Effect.mapError(
		(
			cause:
				| SqlError.SqlError
				| Schema.SchemaError
				| FlightsError
				| PushError
				| Effect.Error<ReturnType<typeof Apns.Service.startActivity>>
		) => PushError.make({cause, message})
	)
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
		const flights = yield* Flights
		const apns = yield* Apns

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
		const findRunning = SqlSchema.findOneOption({
			Request: Activity.insert,
			Result: Activity,
			execute: row => sql`
				SELECT * FROM ${sql(Activity.table)}
				WHERE flightId = ${row.flightId} AND leg = ${row.leg} AND bundle = ${row.bundle} AND endedAt IS NULL
			`
		})
		const listRetirements = SqlSchema.findAll({
			Request: Schema.Void,
			Result: Retirement,
			execute: () => sql`SELECT * FROM ${sql(Retirement.table)} ORDER BY retiredAt`
		})
		const findRetirement = SqlSchema.findOneOption({
			Request: ChannelId,
			Result: Retirement,
			execute: channel => sql`SELECT * FROM ${sql(Retirement.table)} WHERE channel = ${channel}`
		})
		// A channel that never started has no content to end; one that started and was ended is retired, with or without its activity.
		const findUnstarted = SqlSchema.findOneOption({
			Request: Schema.String,
			Result: Retirement,
			execute: bundle => sql`
				SELECT * FROM ${sql(Retirement.table)}
				WHERE bundle = ${bundle} AND props IS NULL AND retiredAt = ${DateTime.toEpochMillis(UNSTARTED)}
				LIMIT 1
			`
		})
		const endSent = SqlSchema.void({
			Request: ChannelId,
			execute: channel => sql`UPDATE ${sql(Retirement.table)} SET props = NULL WHERE channel = ${channel}`
		})
		const forgetRetirement = SqlSchema.void({
			Request: ChannelId,
			execute: channel => sql`DELETE FROM ${sql(Retirement.table)} WHERE channel = ${channel}`
		})
		const recordRetirement = SqlSchema.void({
			Request: Retirement.insert,
			execute: row => sql`INSERT INTO ${sql(Retirement.table)} ${sql.insert(row)} ON CONFLICT (channel) DO NOTHING`
		})
		// Signals that a retirement was written; signals sent while the worker is busy make one more pass, not one each.
		const retiring = yield* Queue.sliding<void>(1)
		const wake = Queue.offer(retiring, undefined)
		// Channels whose start is in flight, which the worker leaves to it; known in memory only, so after a crash the worker deletes them.
		const starting = yield* Ref.make(HashSet.empty<ChannelId>())
		// Channels Apple answered it no longer has, until the activity of each is forgotten; known in memory only, so a restart asks Apple once more.
		const lost = yield* Ref.make(HashSet.empty<ChannelId>())
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
				ON CONFLICT (token) DO UPDATE SET bundle = excluded.bundle, kind = excluded.kind
			`
		})
		// One Live Activity shows per app, started with the token of the iPhone that registered last; older ones would only be tried in the table's order.
		const forgetOtherStarters = SqlSchema.void({
			Request: Device.insert,
			execute: row => sql`
				DELETE FROM ${sql(Device.table)}
				WHERE bundle = ${row.bundle} AND kind = 'start' AND token <> ${row.token}
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
			Request: FlightId,
			Result: SentAlert,
			execute: id => sql`SELECT * FROM ${sql(SentAlert.table)} WHERE flightId = ${id} ORDER BY sentAt`
		})
		const recordSent = SqlSchema.void({
			Request: Schema.NonEmptyArray(SentAlert.insert),
			execute: rows => sql`
				INSERT INTO ${sql(SentAlert.table)} ${sql.insert(rows)}
				ON CONFLICT DO UPDATE SET sentAt = excluded.sentAt
			`
		})
		const listDeliveries = SqlSchema.findAll({
			Request: FlightId,
			Result: AlertDelivery,
			execute: id => sql`SELECT * FROM ${sql(AlertDelivery.table)} WHERE flightId = ${id} ORDER BY sentAt`
		})
		const recordDelivery = SqlSchema.void({
			Request: AlertDelivery.insert,
			execute: row =>
				sql`INSERT INTO ${sql(AlertDelivery.table)} ${sql.insert(row)} ON CONFLICT DO UPDATE SET sentAt = excluded.sentAt`
		})
		const forgetSentExcept = SqlSchema.void({
			Request: Schema.Array(FlightId),
			execute: ids => sql`DELETE FROM ${sql(SentAlert.table)} WHERE flightId NOT IN ${sql.in(ids)}`
		})

		const asPushReadError = asPushError('The push state could not be read.')
		const asPushSaveError = asPushError('The push state could not be saved.')
		const roundState = Effect.gen(function* () {
			return {
				activities: yield* asPushReadError(listActivities()),
				devices: yield* asPushReadError(listDevices())
			} satisfies RoundState
		})

		// A start that Apple did not accept leaves its channel owed to the worker; a rejected or refused token also leaves the device.
		function settle(answer: ApnsAnswer, target: Device) {
			return ApnsAnswer.match(answer, {
				Accepted: () => Effect.void,
				ChannelGone: gone =>
					PushError.make({cause: gone, message: 'Apple does not know the channel of the Live Activity start.'}),
				DeadToken: dead =>
					Effect.andThen(
						asPushSaveError(forgetDevice(target)),
						PushError.make({cause: dead, message: 'Apple rejected the Live Activity token.'})
					),
				Refused: refused =>
					Effect.andThen(
						asPushSaveError(forgetDevice(target)),
						PushError.make({cause: refused, message: 'Apple refused the Live Activity start.'})
					),
				Retry: retry => PushError.make({cause: retry, message: 'Apple did not accept the Live Activity start.'}),
				// The flight's words are too long, which no token can fix, so the iPhone stays registered.
				TooLarge: tooLarge =>
					PushError.make({cause: tooLarge, message: 'The Live Activity has too much text to start.'})
			})
		}

		// Apple has no such channel, so nothing is owed for it: the activity is forgotten and the next round starts its leg afresh, one start per round at most, as after a start that failed. The channel stays known as gone until the write succeeds, so a failed one is tried again without asking Apple.
		const forget = Effect.fnUntraced(function* (activity: Activity) {
			yield* Ref.update(lost, HashSet.add(activity.channel))
			yield* asPushSaveError(activities.delete(activity.channel))
			yield* Ref.update(lost, HashSet.remove(activity.channel))
		})

		// An activity ends in the transaction that queues its channel's retirement; the worker then sends the end and deletes the channel.
		const finish = Effect.fnUntraced(function* (activity: Activity, now: DateTime.Utc) {
			if (HashSet.has(yield* Ref.get(lost), activity.channel)) return yield* forget(activity)
			yield* pipe(
				activities.updateVoid({...editable(activity), endedAt: Option.some(now)}),
				Effect.andThen(
					recordRetirement({
						bundle: activity.bundle,
						channel: activity.channel,
						props: Option.some(activity.props),
						retiredAt: now
					})
				),
				sql.withTransaction,
				asPushSaveError
			)
			yield* wake
		})

		// A channel is written down as owed before its start is sent, so a crash or a refused start leaves it for the worker to delete; the transaction that saves the started activity removes that row, and the one it replaces is retired in it.
		const startOn = Effect.fnUntraced(function* (
			target: Device,
			showing: Showing,
			body: {aps: Record.ReadonlyRecord<string, unknown>}
		) {
			const channel = ChannelId.make(yield* apns.createChannel(target.bundle))
			yield* Effect.acquireUseRelease(
				Ref.update(starting, HashSet.add(channel)),
				Effect.fnUntraced(function* () {
					yield* asPushSaveError(
						recordRetirement({bundle: target.bundle, channel, props: Option.none(), retiredAt: UNSTARTED})
					)
					yield* settle(yield* apns.startActivity(target, showing.leg, channel, body), target)
					const row = {
						bundle: target.bundle,
						channel,
						endedAt: Option.none(),
						flightId: Array.headNonEmpty(showing.journey).id,
						leg: showing.leg,
						phone: target.phone,
						props: showing.props,
						startedAt: showing.now
					}
					yield* pipe(
						forgetRetirement(channel),
						Effect.andThen(findRunning(row)),
						Effect.tap(
							Option.match({
								onNone: () => Effect.void,
								onSome: activity =>
									recordRetirement({
										bundle: activity.bundle,
										channel: activity.channel,
										props: Option.some(activity.props),
										retiredAt: showing.now
									})
							})
						),
						Effect.tap(() => startActivity(row)),
						sql.withTransaction,
						asPushSaveError
					)
				}),
				() => pipe(starting, Ref.update(HashSet.remove(channel)), Effect.andThen(wake))
			)
		})

		// A start waits while Apple has not confirmed deleting an earlier channel of its app that never started, so an outage makes no more channels; an ended activity's channel awaiting its delete does not hold one.
		const launch = Effect.fnUntraced(function* (target: Device, showing: Showing) {
			if (Option.isSome(yield* asPushReadError(findUnstarted(target.bundle)))) {
				return yield* PushError.make({message: 'Apple has not confirmed deleting the channel of an earlier start.'})
			}
			const body = {
				aps: {
					alert: startAlert(showing.flight),
					attributes: {url: `${SCHEMES[target.bundle]}://flight/${Array.headNonEmpty(showing.journey).id}`},
					'attributes-type': 'LiveActivityAttributes',
					'content-state': yield* contentState(showing.props),
					event: 'start',
					'relevance-score': 100,
					timestamp: DateTime.toEpochSeconds(showing.now)
				}
			}
			yield* Option.match(yield* apns.startHeld(target, showing.leg, body), {
				onNone: () => startOn(target, showing, body),
				onSome: answer => settle(answer, target)
			})
		})

		// The end goes first; the retirement is forgotten only after Apple deleted the channel or answered that it never will, so a throttled answer or a restart leaves it for the next pass, and an end Apple accepted is sent again when Trips stops before it saved that it was sent.
		const retire = Effect.fnUntraced(function* (retirement: Retirement, now: DateTime.Utc) {
			yield* Option.match(retirement.props, {
				onNone: () => Effect.void,
				onSome: Effect.fnUntraced(function* (props) {
					const answer = yield* apns.broadcast(
						retirement.bundle,
						retirement.channel,
						{
							'content-state': yield* contentState(props),
							'dismissal-date': DateTime.toEpochSeconds(DateTime.addDuration(now, Duration.minutes(10))),
							event: 'end',
							timestamp: DateTime.toEpochSeconds(now)
						},
						10,
						now
					)
					if (ApnsAnswer.isAnyOf(['Retry'])(answer)) {
						return yield* PushError.make({cause: answer, message: 'Apple did not accept the Live Activity end.'})
					}
					yield* asPushSaveError(endSent(retirement.channel))
				})
			})
			const deleted = yield* asPushError('Apple was not asked to delete the Live Activity channel.')(
				apns.deleteChannel(retirement.bundle, retirement.channel)
			)
			if (ApnsAnswer.isAnyOf(['Retry'])(deleted)) {
				return yield* PushError.make({cause: deleted, message: 'Apple did not delete the Live Activity channel.'})
			}
			yield* asPushSaveError(forgetRetirement(retirement.channel))
		})

		// A channel whose start is in flight is that start's until it saves the activity or fails.
		const retireUnlessStarting = Effect.fnUntraced(function* (listed: Retirement, now: DateTime.Utc) {
			if (HashSet.has(yield* Ref.get(starting), listed.channel)) return
			// Read again, since the start may have saved the channel as an activity after the list was read.
			yield* Option.match(yield* asPushReadError(findRetirement(listed.channel)), {
				onNone: () => Effect.void,
				onSome: current => retire(current, now)
			})
		})

		// Claims every pending retirement at start, after each signal, and each minute for the answers Apple asked to retry.
		yield* pipe(
			Effect.gen(function* () {
				if (!apns.enabled) return
				const now = yield* DateTime.now
				yield* Effect.forEach(
					yield* asPushReadError(listRetirements()),
					retirement =>
						Effect.ignore(retireUnlessStarting(retirement, now), {
							log: 'Warn',
							message: 'A Live Activity channel was not retired'
						}),
					{concurrency: 1, discard: true}
				)
			}),
			Effect.ignore({log: 'Warn', message: 'The Live Activity retirements could not be read'}),
			Effect.andThen(Effect.timeoutOrElse(Queue.take(retiring), {duration: '1 minute', orElse: () => Effect.void})),
			Effect.forever,
			Effect.forkScoped
		)

		// A change APNs took or will always refuse is remembered; a throttled one is sent again next round. The changes the activity tells as its own alert count as delivered to its iPhone, so no notification repeats them there.
		const refresh = Effect.fnUntraced(function* (
			activity: Activity,
			props: ActivityProps,
			now: DateTime.Utc,
			riding: readonly Riding[],
			devices: readonly Device[]
		) {
			if (HashSet.has(yield* Ref.get(lost), activity.channel)) return yield* forget(activity)
			const shown = yield* contentState(activity.props)
			const next = yield* contentState(props)
			if (next.props === shown.props && Array.isReadonlyArrayEmpty(riding)) return
			const told = Array.match(riding, {
				onEmpty: () => ({}),
				onNonEmpty: alerts => ({
					alert: {
						body: line([
							Option.some(Array.headNonEmpty(alerts).alert.body),
							...Array.map(Array.tailNonEmpty(alerts), item => Option.some(item.alert.title))
						]),
						sound: 'default',
						title: Array.headNonEmpty(alerts).alert.title
					}
				})
			})
			const answer = yield* apns.broadcast(
				activity.bundle,
				activity.channel,
				{'content-state': next, event: 'update', timestamp: DateTime.toEpochSeconds(now), ...told},
				Boolean.match(urgencyOf(activity.props) === urgencyOf(props) && Array.isReadonlyArrayEmpty(riding), {
					onFalse: Function.constant(10 as const),
					onTrue: Function.constant(5 as const)
				}),
				now
			)
			const phones = activityPhones(devices, activity)
			const deliver = Effect.forEach(
				riding,
				item =>
					Effect.forEach(
						phones,
						device =>
							recordDelivery({
								category: item.alert.category,
								flightId: item.flightId,
								sentAt: now,
								token: device.token,
								value: Option.fromUndefinedOr(item.alert.value)
							}),
						{concurrency: 1, discard: true}
					),
				{concurrency: 1, discard: true}
			)
			yield* ApnsAnswer.match(answer, {
				Accepted: () => asPushSaveError(Effect.andThen(activities.updateVoid({...editable(activity), props}), deliver)),
				ChannelGone: () => forget(activity),
				DeadToken: () => asPushSaveError(activities.updateVoid({...editable(activity), endedAt: Option.some(now)})),
				Refused: () => asPushSaveError(activities.updateVoid({...editable(activity), props})),
				Retry: retry => PushError.make({cause: retry, message: 'Apple did not accept the Live Activity update.'}),
				// Sending the same text again would be refused again, so it is remembered like a refusal and the activity stays.
				TooLarge: () => asPushSaveError(activities.updateVoid({...editable(activity), props}))
			})
		})

		// The changes of each flight of the day its activity tells as its own alert; receipts are read only for a flight with such a change.
		const ridingOf = Effect.fnUntraced(function* (
			journey: Journey,
			alerts: Record.ReadonlyRecord<string, readonly Alert[]>,
			devices: readonly Device[],
			activity: Activity
		) {
			const each = yield* Effect.forEach(
				journey,
				Effect.fnUntraced(function* (flight) {
					const candidates = alerts[flight.id] ?? []
					if (!Array.some(candidates, ridesActivity)) return Array.empty<Riding>()
					const receipts = yield* asPushReadError(
						Effect.all({delivered: listDeliveries(flight.id), sent: listSent(flight.id)}, {concurrency: 1})
					)
					return Array.map(
						ridingAlerts(candidates, receipts.sent, receipts.delivered, devices, activity),
						alert => ({alert, flightId: flight.id}) satisfies Riding
					)
				}),
				{concurrency: 1}
			)
			return Array.flatten(each)
		})

		const show = Effect.fnUntraced(function* (
			journey: Journey,
			window: Span & {leg: Leg},
			now: DateTime.Utc,
			state: RoundState,
			context: {alerts: Record.ReadonlyRecord<string, readonly Alert[]>; travel: readonly TravelTime[]}
		) {
			const current = stepOf(journey, now, context.travel)
			const showing = {
				flight: current.flight,
				journey,
				leg: window.leg,
				now,
				props: activityProps(journey, current, context.travel, isStale(current.flight, now)),
				window
			} satisfies Showing
			const id = Array.headNonEmpty(journey).id
			// An activity that cannot cover the window ends, and the window starts afresh.
			const ended = yield* pipe(
				state.activities,
				Array.filter(
					activity =>
						activity.flightId === id &&
						activity.leg === window.leg &&
						Option.isNone(activity.endedAt) &&
						!holds(activity, window)
				),
				Effect.forEach(
					activity => Effect.map(Effect.result(finish(activity, now)), result => ({bundle: activity.bundle, result})),
					{concurrency: 1}
				)
			)
			// An app's window starts only once its earlier activity ended, so a start never retires a channel Apple no longer has while its activity waits to be forgotten; an activity that covers the window is refreshed all the same.
			const held = pipe(
				ended,
				Array.filter(end => Result.isFailure(end.result)),
				Array.map(end => end.bundle)
			)
			const outcomes = yield* Effect.forEach(
				showPlan(state.devices, state.activities, journey, window),
				action => {
					if (!ShowAction.isAnyOf(['launch'])(action)) {
						return Effect.result(
							Effect.flatMap(ridingOf(journey, context.alerts, state.devices, action.target), riding =>
								refresh(action.target, showing.props, now, riding, state.devices)
							)
						)
					}
					if (Array.contains(held, action.target.bundle)) return Effect.result(Effect.void)
					return Effect.result(launch(action.target, showing))
				},
				{concurrency: 1}
			)
			yield* Option.match(
				Array.head([...Array.getFailures(Array.map(ended, end => end.result)), ...Array.getFailures(outcomes)]),
				{onNone: () => Effect.void, onSome: Effect.fail}
			)
		})

		// A device whose token died leaves the list with its first failed alert, which it never took: `settled` is Apple's last word for the phone, `gone` a token forgotten, `later` an alert to send again.
		const notify = Effect.fnUntraced(function* (device: Device, alert: Alert, flight: Flight) {
			const directions = yield* Effect.transposeOption(
				Option.map(Option.fromUndefinedOr(alert.directions), Schema.encodeEffect(Place))
			)
			const answer = yield* apns.sendToDevice(
				device,
				'alert',
				{
					aps: {
						alert: {body: alert.body, title: alert.title},
						sound: 'default',
						'thread-id': flight.id,
						// The app registers this category's Directions and Uber actions, which lead to the place sent beside it.
						...Option.match(directions, {onNone: () => ({}), onSome: () => ({category: 'leave'})})
					},
					// The app reads a notification's data from `body`: the flight a tap opens and the airport its actions lead to.
					body: {flightId: flight.id, ...Option.match(directions, {onNone: () => ({}), onSome: place => ({place})})}
				},
				10,
				// A gate or boarding time the phone must end on replaces the one it showed before.
				Boolean.match(perDevice(alert), {
					onFalse: Function.constUndefined,
					onTrue: () => `${flight.id}-${alert.category}`
				})
			)
			return yield* ApnsAnswer.match(answer, {
				Accepted: () => Effect.succeed('settled' as const),
				ChannelGone: () => Effect.succeed('settled' as const),
				DeadToken: () => Effect.as(asPushSaveError(forgetDevice(device)), 'gone' as const),
				Refused: () => Effect.succeed('settled' as const),
				Retry: () => Effect.succeed('later' as const),
				// The alert itself can never fit, so it is final for this device, which stays registered.
				TooLarge: () => Effect.succeed('settled' as const)
			})
		})

		// Only a flight with something to say reads its receipts, through their index on (flightId, sentAt).
		const announce = Effect.fnUntraced(function* (flight: Flight, now: DateTime.Utc, candidates: readonly Alert[]) {
			if (Array.isReadonlyArrayEmpty(candidates)) return
			const sent = yield* asPushReadError(listSent(flight.id))
			const due = Array.filter(candidates, alert => perDevice(alert) || !announced(sent, alert))
			if (Array.isReadonlyArrayEmpty(due)) return
			const delivered = yield* asPushReadError(listDeliveries(flight.id))
			yield* Effect.forEach(
				due,
				Effect.fnUntraced(function* (alert) {
					const devices = Array.filter(yield* asPushReadError(listDevices()), device => device.kind === 'alert')
					const row = {
						category: alert.category,
						flightId: flight.id,
						sentAt: now,
						value: Option.fromUndefinedOr(alert.value)
					}
					const pending = unannouncedDevices(devices, delivered, alert)
					// The flight-wide record of a per-device value is a summary, written once every phone has it.
					if (perDevice(alert) && Array.isReadonlyArrayEmpty(pending) && announced(sent, alert)) return
					const outcomes = yield* Effect.forEach(
						pending,
						device =>
							Effect.catch(
								Effect.gen(function* () {
									const outcome = yield* notify(device, alert, flight)
									if (outcome === 'settled') yield* asPushSaveError(recordDelivery({...row, token: device.token}))
									return outcome
								}),
								cause => Effect.as(Effect.logWarning('An alert was not sent', Cause.fail(cause)), 'later' as const)
							),
						{concurrency: 1}
					)
					// Only a phone still registered that took it makes it sent, so one registered later in the window still gets it, also after the only token died.
					if (
						devices.length > Array.countBy(outcomes, outcome => outcome === 'gone') &&
						!Array.contains(outcomes, 'later')
					) {
						yield* asPushSaveError(recordSent([row]))
					}
				}),
				{concurrency: 1, discard: true}
			)
		})

		const ticking = yield* Semaphore.make(1)
		const tick = pipe(
			Effect.gen(function* () {
				if (!apns.enabled) return
				const now = yield* DateTime.now
				const all = yield* flights.list
				const state = yield* roundState
				const travel = yield* asPushReadError(flights.travel)
				const context = {flights: all, travel}
				const alerts = Record.fromIterableWith(all, flight => [flight.id, alertsOf(flight, now, context)] as const)
				const journeys = journeysOf(all)
				// The activities go first, so a change one tells itself is no notification as well.
				yield* Effect.forEach(
					journeys,
					journey =>
						pipe(
							activeWindow(journey, now, travel),
							Option.match({
								onNone: () => Effect.void,
								onSome: window => show(journey, window, now, state, {alerts, travel})
							}),
							Effect.ignore({
								log: 'Warn',
								message: `The Live Activity of ${Array.headNonEmpty(journey).id} was not updated`
							})
						),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					all,
					flight =>
						Effect.ignore(announce(flight, now, alerts[flight.id] ?? []), {
							log: 'Warn',
							message: `The alerts of ${flight.id} were not sent`
						}),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					expiredActivities(state.activities, journeys, now, travel),
					activity => Effect.ignore(finish(activity, now), {log: 'Warn', message: 'An activity was not ended'}),
					{concurrency: 1, discard: true}
				)
				// Nothing reads an activity two days after it ended, or the alerts of a flight that left.
				yield* pipe(
					Effect.andThen(
						forgetEndedBefore(DateTime.subtractDuration(now, Duration.days(2))),
						Effect.all(
							[
								forgetSentExcept(Array.map(all, flight => flight.id)),
								sql`DELETE FROM deliveries WHERE flightId NOT IN ${sql.in(Array.map(all, flight => flight.id))}`
							],
							{concurrency: 1, discard: true}
						)
					),
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
				flights.watch,
				Stream.debounce('2 seconds'),
				Stream.runForEach(() => tick),
				Effect.ignore({log: 'Warn', message: 'The flights stopped reaching the push rounds'})
			)
		)

		return {
			// A round follows each registration, so a phone that registers inside a flight's window gets its Live Activity and the alerts it is owed at once; activities start only this way.
			register: Effect.fn('Push.register')(function* (device: typeof Device.insert.Type) {
				yield* pipe(
					Effect.gen(function* () {
						yield* saveDevice(device)
						if (device.kind === 'start') yield* forgetOtherStarters(device)
					}),
					sql.withTransaction,
					asPushSaveError
				)
				yield* tick
			})
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
				}),
				'0004_device_delivery': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`ALTER TABLE devices RENAME TO old_devices`
					yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY, bundle TEXT NOT NULL, kind TEXT NOT NULL) STRICT, WITHOUT ROWID`
					yield* sql`INSERT INTO devices SELECT token, bundle, kind FROM old_devices`
					yield* sql`DROP TABLE old_devices`
					yield* sql`CREATE TABLE deliveries (bookingId TEXT NOT NULL, category TEXT NOT NULL, value TEXT, sentAt INTEGER NOT NULL, token TEXT NOT NULL) STRICT`
					yield* sql`CREATE UNIQUE INDEX delivery_value ON deliveries (bookingId, category, value, token) WHERE value IS NOT NULL`
					yield* sql`CREATE UNIQUE INDEX delivery_once ON deliveries (bookingId, category, token) WHERE value IS NULL`
				}),
				// A round reads one booking's receipts in the order they were sent; neither partial unique index covers that read.
				'0005_receipt_order': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`CREATE INDEX delivery_order ON deliveries (bookingId, sentAt)`
					yield* sql`CREATE INDEX alert_order ON sent_alerts (bookingId, sentAt)`
				}),
				// Channels still to end or delete; every activity ended before it had its channel deleted already.
				'0006_retirements': Effect.gen(function* () {
					yield* (yield* SqlClient.SqlClient)`
						CREATE TABLE retirements (
							channel TEXT PRIMARY KEY,
							bundle TEXT NOT NULL,
							props TEXT,
							retiredAt INTEGER NOT NULL
						) STRICT, WITHOUT ROWID
					`
				}),
				// Trains left, and their props no longer decode: a train's activity becomes a channel that is only deleted, and a train's retirement still deletes its channel without sending the end.
				'0007_no_trains': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const now = DateTime.toEpochMillis(yield* DateTime.now)
					yield* sql`UPDATE retirements SET props = NULL WHERE json_extract(props, '$.kind') = 'train'`
					yield* sql`
						INSERT INTO retirements (channel, bundle, props, retiredAt)
						SELECT channel, bundle, NULL, ${now} FROM activities WHERE json_extract(props, '$.kind') = 'train'
						ON CONFLICT (channel) DO NOTHING
					`
					yield* sql`DELETE FROM activities WHERE json_extract(props, '$.kind') = 'train'`
				}),
				// Baggage belts left, and a belt's alert records name a category that no longer decodes.
				'0008_no_belts': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`DELETE FROM sent_alerts WHERE category = 'belt'`
					yield* sql`DELETE FROM deliveries WHERE category = 'belt'`
				}),
				// Trips holds only flights, so each table names the flight its rows belong to.
				'0009_flight_ids': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					yield* sql`ALTER TABLE activities RENAME COLUMN bookingId TO flightId`
					yield* sql`ALTER TABLE sent_alerts RENAME COLUMN bookingId TO flightId`
					yield* sql`ALTER TABLE deliveries RENAME COLUMN bookingId TO flightId`
					// Live Activities start only by themselves, so nothing reads when one was asked for.
					yield* sql`DROP TABLE requests`
				}),
				// A token names the iPhone it belongs to, and an activity the iPhone it runs on. Older tokens never said, so they go, and each app registers both again at its next launch; a running activity is retired, and the next round starts it afresh on a named phone.
				'0010_phones': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const now = DateTime.toEpochMillis(yield* DateTime.now)
					yield* sql`DROP TABLE devices`
					yield* sql`CREATE TABLE devices (token TEXT PRIMARY KEY, bundle TEXT NOT NULL, kind TEXT NOT NULL, phone TEXT NOT NULL) STRICT, WITHOUT ROWID`
					yield* sql`
						INSERT INTO retirements (channel, bundle, props, retiredAt)
						SELECT channel, bundle, props, ${now} FROM activities WHERE endedAt IS NULL
						ON CONFLICT (channel) DO NOTHING
					`
					yield* sql`DROP TABLE activities`
					yield* sql`
						CREATE TABLE activities (
							channel TEXT PRIMARY KEY,
							flightId TEXT NOT NULL,
							leg TEXT NOT NULL,
							bundle TEXT NOT NULL,
							phone TEXT NOT NULL,
							startedAt INTEGER NOT NULL,
							endedAt INTEGER,
							props TEXT NOT NULL,
							UNIQUE (flightId, leg, bundle)
						) STRICT
					`
				}),
				// One activity follows the whole day, and the props of a flight's activity no longer decode: each running one becomes a channel that is only deleted, and a retirement still deletes its channel without sending the end.
				'0011_day_activities': Effect.gen(function* () {
					const sql = yield* SqlClient.SqlClient
					const now = DateTime.toEpochMillis(yield* DateTime.now)
					yield* sql`UPDATE retirements SET props = NULL`
					yield* sql`
						INSERT INTO retirements (channel, bundle, props, retiredAt)
						SELECT channel, bundle, NULL, ${now} FROM activities WHERE endedAt IS NULL
						ON CONFLICT (channel) DO NOTHING
					`
					yield* sql`DELETE FROM activities`
				})
			}),
			table: 'push_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
