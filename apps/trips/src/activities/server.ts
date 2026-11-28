import type {Record} from 'effect'
import {
	Array,
	Boolean,
	Context,
	DateTime,
	Duration,
	Effect,
	Function,
	HashSet,
	Layer,
	Option,
	Queue,
	Ref,
	Result,
	Schema,
	Struct,
	pipe
} from 'effect'

import {SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {Apns} from '@deslop/runtime/server/apns'
import {ApnsAnswer} from '@deslop/runtime/shared/apns'

import {Activity, ActivityPropsJson, ChannelId, Retirement, ShowAction} from './contract.ts'
import type {ActivityProps, Leg} from './contract.ts'
import {activityProps, islandOf} from './shared.ts'

import type {Flight, FlightId, TravelTime} from '#flights/contract.ts'
import {isStale, line, stepOf} from '#flights/shared.ts'
import type {Journey} from '#flights/shared.ts'
import type {Device} from '#push/contract.ts'
import {PushError} from '#push/contract.ts'
import {activityPhones, holds, ridesActivity, ridingAlerts, showPlan, startAlert, urgencyOf} from '#push/policy.ts'
import type {Alert, Span} from '#push/policy.ts'
import {Push, asPushError, asPushReadError, asPushSaveError} from '#push/server.ts'

const ACTIVITY_NAME = 'JourneyActivity'

const SCHEMES: Record.ReadonlyRecord<string, string> = {
	'xyz.mp281x.trips': 'trips',
	'xyz.mp281x.trips.dev': 'trips-dev'
}

// A channel written down before its start is sent was never retired, so it carries the epoch where a retired one carries the time it was; that tells it from a started channel whose end Apple took, whose activity may be gone.
const UNSTARTED = DateTime.makeUnsafe(0)

// The day an activity shows, and the flight it is at.
type Showing = {flight: Flight; journey: Journey; leg: Leg; now: DateTime.Utc; props: ActivityProps; window: Span}
// A change the activity tells as its own alert, with the flight it is about.
type Riding = {alert: Alert; flightId: FlightId}
export type RoundState = {activities: readonly Activity[]; devices: readonly Device[]}

// The activity's columns an update writes, to change only some of them.
function editable(activity: Activity) {
	return Struct.pick(activity, Struct.keys(Activity.update.fields))
}

// The Live Activity of each day: started on the iPhone that registered last, updated through its broadcast channel, ended and its channel deleted once its window passed.
export class Activities extends Context.Service<Activities>()('@deslop/trips/activities/server/Activities', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const push = yield* Push
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
		const forgetEndedBefore = SqlSchema.void({
			Request: Schema.DateTimeUtcFromMillis,
			execute: time => sql`DELETE FROM ${sql(Activity.table)} WHERE endedAt < ${time}`
		})
		// Signals that a retirement was written; signals sent while the worker is busy make one more pass, not one each.
		const retiring = yield* Queue.sliding<void>(1)
		const wake = Queue.offer(retiring, undefined)
		// Channels whose start is in flight, which the worker leaves to it; known in memory only, so after a crash the worker deletes them.
		const starting = yield* Ref.make(HashSet.empty<ChannelId>())
		// Channels Apple answered it no longer has, until the activity of each is forgotten; known in memory only, so a restart asks Apple once more.
		const lost = yield* Ref.make(HashSet.empty<ChannelId>())

		// A start that Apple did not accept leaves its channel owed to the worker; a rejected or refused token also leaves the device.
		function settle(answer: ApnsAnswer, target: Device) {
			return ApnsAnswer.match(answer, {
				Accepted: () => Effect.void,
				ChannelGone: gone =>
					PushError.make({cause: gone, message: 'Apple does not know the channel of the Live Activity start.'}),
				DeadToken: dead =>
					Effect.andThen(
						push.forget(target),
						PushError.make({cause: dead, message: 'Apple rejected the Live Activity token.'})
					),
				Refused: refused =>
					Effect.andThen(
						push.forget(target),
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
		const finish = Effect.fn('Activities.finish')(function* (activity: Activity, now: DateTime.Utc) {
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
					// The day's link: the phone opens the flight the day is at when it is tapped, since an activity's attributes never change.
					attributes: {url: `${SCHEMES[target.bundle]}://day/${Array.headNonEmpty(showing.journey).id}`},
					'attributes-type': 'LiveActivityAttributes',
					'content-state': {name: ACTIVITY_NAME, props: yield* Schema.encodeEffect(ActivityPropsJson)(showing.props)},
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
							'content-state': {name: ACTIVITY_NAME, props: yield* Schema.encodeEffect(ActivityPropsJson)(props)},
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
			showing: Showing,
			riding: readonly Riding[],
			devices: readonly Device[]
		) {
			if (HashSet.has(yield* Ref.get(lost), activity.channel)) return yield* forget(activity)
			const shown = yield* Schema.encodeEffect(ActivityPropsJson)(activity.props)
			const next = yield* Schema.encodeEffect(ActivityPropsJson)(showing.props)
			if (next === shown && Array.isReadonlyArrayEmpty(riding)) return
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
				{
					'content-state': {name: ACTIVITY_NAME, props: next},
					event: 'update',
					timestamp: DateTime.toEpochSeconds(showing.now),
					...told
				},
				Boolean.match(urgencyOf(activity.props) === urgencyOf(showing.props) && Array.isReadonlyArrayEmpty(riding), {
					onFalse: Function.constant(10 as const),
					onTrue: Function.constant(5 as const)
				}),
				showing.now
			)
			const phones = activityPhones(devices, activity)
			const deliver = push.record(
				Array.flatMap(riding, item =>
					Array.map(phones, device => ({
						category: item.alert.category,
						flightId: item.flightId,
						sentAt: showing.now,
						token: device.token,
						value: Option.fromUndefinedOr(item.alert.value)
					}))
				)
			)
			yield* ApnsAnswer.match(answer, {
				Accepted: () =>
					Effect.andThen(
						asPushSaveError(activities.updateVoid({...editable(activity), props: showing.props})),
						deliver
					),
				ChannelGone: () => forget(activity),
				DeadToken: () =>
					asPushSaveError(activities.updateVoid({...editable(activity), endedAt: Option.some(showing.now)})),
				Refused: () => asPushSaveError(activities.updateVoid({...editable(activity), props: showing.props})),
				Retry: retry => PushError.make({cause: retry, message: 'Apple did not accept the Live Activity update.'}),
				// Sending the same text again would be refused again, so it is remembered like a refusal and the activity stays.
				TooLarge: () => asPushSaveError(activities.updateVoid({...editable(activity), props: showing.props}))
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
					const receipts = yield* push.receipts(flight.id)
					return Array.map(
						ridingAlerts(candidates, receipts.sent, receipts.delivered, devices, activity),
						alert => ({alert, flightId: flight.id}) satisfies Riding
					)
				}),
				{concurrency: 1}
			)
			return Array.flatten(each)
		})

		return {
			// Ends an activity, which the worker then retires.
			finish,
			// Nothing reads an activity two days after it ended.
			forgetEndedBefore,
			list: asPushReadError(listActivities()),
			// Shows the day on each app: refreshes the activity that covers the window, or starts one on the app's start token.
			show: Effect.fn('Activities.show')(function* (
				journey: Journey,
				window: Span & {leg: Leg},
				now: DateTime.Utc,
				state: RoundState,
				context: {alerts: Record.ReadonlyRecord<string, readonly Alert[]>; travel: readonly TravelTime[]}
			) {
				const current = stepOf(journey, now, context.travel)
				const stale = isStale(current.flight, now)
				const step = activityProps(journey, current, context.travel, stale)
				const showing = {
					flight: current.flight,
					journey,
					leg: window.leg,
					now,
					props: Option.match(Option.fromUndefinedOr(islandOf(current.flight, step, context.travel, stale)), {
						onNone: () => step,
						onSome: words => ({...step, island: words})
					}),
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
									refresh(action.target, showing, riding, state.devices)
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
		}
	})
}) {
	static readonly layer = Layer.effect(this, this.make)
}
