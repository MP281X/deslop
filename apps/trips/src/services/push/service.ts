import {NodeHttpClient} from '@effect/platform-node'
import Undici from '@effect/platform-node/Undici'

import {
	Array,
	Boolean,
	Cause,
	Clock,
	Config,
	Context,
	Effect,
	Exit,
	HashMap,
	Layer,
	Option,
	Redacted,
	Ref,
	Result,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Jwk, Jws} from 'effect/jose'
import {Reactivity} from 'effect/reactivity'
import {Migrator, SqlClient, SqlModel, SqlSchema} from 'effect/sql'

import {ACTIVITY_NAME, activeWindow, activityProps, DAY, HOUR, MINUTE, urgencyOf} from '#services/bookings/lib/utils.ts'
import type {ActivityProps, Booking, BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import {BookingId} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {
	alertKey,
	alertsOf,
	announced,
	expiredActivities,
	holds,
	showPlan,
	startAlert
} from '#services/push/lib/utils.ts'
import type {Alert} from '#services/push/lib/utils.ts'
import type {Bundle} from '#services/push/schema.ts'
import {
	Activity,
	ActivityPropsJson,
	ApnsReason,
	Device,
	JwtClaims,
	PushError,
	SentAlert
} from '#services/push/schema.ts'

// The store build pushes through production and the Simulator build through the sandbox; a TestFlight app cannot report it.
const BUNDLES = {
	'xyz.mp281x.trips': {
		channels: 'https://api-manage-broadcast.push.apple.com:2196',
		host: 'https://api.push.apple.com',
		scheme: 'trips'
	},
	'xyz.mp281x.trips.dev': {
		channels: 'https://api-manage-broadcast.sandbox.push.apple.com:2195',
		host: 'https://api.sandbox.push.apple.com',
		scheme: 'trips-dev'
	}
}

type Apns = {bundle: Bundle}
type Answer = {channel: Option.Option<string>; reason: Option.Option<string>; status: number}
type Span = {end: number; start: number}
type Showing = {journey: Flight | Train; leg: Leg; now: number; props: ActivityProps; window: Span}

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly push: never
	}
}

export const layerApnsClient = Layer.effect(
	HttpClient.HttpClient,
	Effect.gen(function* () {
		// APNs requires HTTP/2; the bundle exposes Undici's default export, not the named Agent used by layerUndiciOptions.
		const dispatcher = yield* Effect.acquireRelease(
			Effect.sync(() => new Undici.Agent({allowH2: true})),
			agent => Effect.promise(() => agent.destroy())
		)
		return yield* Effect.provideService(NodeHttpClient.makeUndici, NodeHttpClient.Dispatcher, dispatcher)
	})
)

// APNs drops a token whose app is gone or which belongs to the other environment.
function deadToken(answer: Answer) {
	return (
		answer.status === 410 ||
		Option.exists(answer.reason, reason => reason === 'BadDeviceToken' || reason === 'Unregistered')
	)
}

function accepted(answer: Answer) {
	return answer.status >= 200 && answer.status < 300
}

// Throttling and Apple's own failures pass; any other refusal, such as a wrong topic, fails the same way every time.
function retryable(answer: Answer) {
	return answer.status === 429 || answer.status >= 500
}

function seconds(time: number) {
	return Math.floor(time / 1000)
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

// Talks to Apple's push service directly: Expo's push service cannot send Live Activity updates.
export class Push extends Context.Service<Push>()('@deslop/trips/services/push/service/Push', {
	make: Effect.gen(function* () {
		const sql = yield* SqlClient.SqlClient
		const bookings = yield* Bookings
		const keyId = yield* Config.option(Config.String('APNS_KEY_ID'))
		const teamId = yield* Config.option(Config.String('APNS_TEAM_ID'))
		const privateKey = yield* Config.option(Config.Redacted('APNS_KEY'))
		const client = yield* HttpClient.HttpClient
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
			Request: Schema.Int,
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
			Request: BookingId,
			Result: SentAlert,
			execute: id => sql`SELECT * FROM ${sql(SentAlert.table)} WHERE bookingId = ${id} ORDER BY sentAt`
		})
		const recordSent = SqlSchema.void({
			Request: Schema.NonEmptyArray(SentAlert.insert),
			execute: rows => sql`
				INSERT INTO ${sql(SentAlert.table)} ${sql.insert(rows)}
				ON CONFLICT (bookingId, key) DO UPDATE SET sentAt = excluded.sentAt
			`
		})
		const forgetSentExcept = SqlSchema.void({
			Request: Schema.Array(BookingId),
			execute: ids => sql`DELETE FROM ${sql(SentAlert.table)} WHERE bookingId NOT IN ${sql.in(ids)}`
		})

		const asPushReadError = asPushError('The push state could not be read.')
		const asPushSaveError = asPushError('The push state could not be saved.')

		const signer = Option.all({keyId, privateKey, teamId})
		if (Option.isNone(signer)) {
			yield* Effect.logWarning(
				'No APNS_KEY, APNS_KEY_ID or APNS_TEAM_ID: notifications and Live Activity updates are off'
			)
		}

		const signingKey = yield* Effect.cached(
			Effect.gen(function* () {
				const found = yield* Effect.fromOption(signer)
				const der = yield* Effect.fromResult(
					Base64.decode(String.replaceAll(/-----[^-]+-----|\\n|\s/gu, '')(Redacted.value(found.privateKey)))
				)
				return yield* Jwk.importPkcs8(Redacted.make(der), 'ES256', {kid: found.keyId})
			})
		)
		const retrying = yield* Ref.make(HashMap.empty<string, {answer: Answer; until: number}>())

		// APNs accepts a provider token for an hour and refuses one renewed more than every twenty minutes.
		const providerToken = yield* pipe(
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis
				const found = yield* Effect.fromOption(signer)
				return yield* Jws.sign(
					new TextEncoder().encode(yield* Schema.encodeEffect(JwtClaims)({iat: seconds(now), iss: found.teamId})),
					yield* signingKey,
					{kid: found.keyId}
				)
			}),
			asPushError('The APNs key could not sign a token.'),
			Effect.cachedWithTTL(exit => Exit.match(exit, {onFailure: () => 0, onSuccess: () => '40 minutes'}))
		)

		const send = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest, notification?: string) {
			const now = yield* Clock.currentTimeMillis
			const key = notification ?? `${request.method} ${request.url} ${request.headers['apns-channel-id'] ?? ''}`
			const deferred = Option.getOrUndefined(
				pipe(
					yield* Ref.get(retrying),
					HashMap.get(key),
					Option.filter(pending => pending.until > now)
				)
			)
			if (deferred !== undefined) return deferred.answer
			const response = yield* pipe(
				client.execute(
					HttpClientRequest.setHeader(request, 'authorization', `bearer ${Redacted.value(yield* providerToken)}`)
				),
				Effect.timeout('20 seconds'),
				asPushError('APNs did not answer.')
			)
			const reason = yield* pipe(
				HttpClientResponse.schemaBodyJson(ApnsReason)(response),
				Effect.map(body => Option.some(body.reason)),
				Effect.orElseSucceed(() => Option.none<string>())
			)
			if (response.status >= 300) {
				yield* Effect.logWarning(`APNs refused a push: ${response.status} ${Option.getOrElse(reason, () => '')}`)
			}
			const answer = {
				channel: Option.fromNullishOr(response.headers['apns-channel-id']),
				reason,
				status: response.status
			} satisfies Answer
			const receivedAt = yield* Clock.currentTimeMillis
			yield* Ref.update(retrying, pending => {
				const current = HashMap.filter(pending, entry => entry.until > receivedAt)
				if (!retryable(answer)) return HashMap.remove(current, key)
				// Apple asks for fifteen minutes after 5xx; token throttling waits at least one round.
				return HashMap.set(current, key, {
					answer,
					until: receivedAt + Boolean.match(answer.status >= 500, {onFalse: () => 30_000, onTrue: () => 15 * MINUTE})
				})
			})
			return answer
		})

		function sendToDevice(
			target: Device,
			type: 'alert' | 'liveactivity',
			body: unknown,
			priority: 5 | 10,
			notification?: string
		) {
			return pipe(
				HttpClientRequest.post(`${BUNDLES[target.bundle].host}/3/device/${Redacted.value(target.token)}`, {
					headers: {
						'apns-priority': `${priority}`,
						'apns-push-type': type,
						'apns-topic': Boolean.match(type === 'liveactivity', {
							onFalse: () => target.bundle,
							onTrue: () => `${target.bundle}.push-type.liveactivity`
						})
					}
				}),
				HttpClientRequest.bodyJson(body),
				Effect.flatMap(request => send(request, notification))
			)
		}

		// Most recent message stored, so a phone offline in flight gets the latest state when it reconnects.
		const createChannel = Effect.fnUntraced(function* (target: Apns) {
			const answer = yield* send(
				yield* asPushError('The channel request could not be written.')(
					HttpClientRequest.bodyJson(
						HttpClientRequest.post(`${BUNDLES[target.bundle].channels}/1/apps/${target.bundle}/channels`),
						{'message-storage-policy': 1, 'push-type': 'LiveActivity'}
					)
				)
			)
			return yield* pipe(
				answer.channel,
				Effect.fromOption,
				Effect.mapError(() => PushError.make({message: `APNs created no channel: ${answer.status}`}))
			)
		})

		function deleteChannel(target: Apns & {channel: string}) {
			return Effect.ignore(
				send(
					HttpClientRequest.delete(`${BUNDLES[target.bundle].channels}/1/apps/${target.bundle}/channels`, {
						headers: {'apns-channel-id': target.channel}
					})
				),
				{log: 'Warn', message: 'A finished activity channel was not deleted'}
			)
		}

		// The channel stores the latest message for a phone offline in flight, as long as an activity lives.
		function broadcast(activity: Activity, aps: Record<string, unknown>, priority: 5 | 10, now: number) {
			return pipe(
				HttpClientRequest.post(`${BUNDLES[activity.bundle].host}/4/broadcasts/apps/${activity.bundle}`, {
					headers: {
						'apns-channel-id': activity.channel,
						'apns-expiration': `${seconds(now + 8 * HOUR)}`,
						'apns-priority': `${priority}`,
						'apns-push-type': 'liveactivity'
					}
				}),
				HttpClientRequest.bodyJson({aps}),
				Effect.flatMap(send)
			)
		}

		const pushStart = Effect.fnUntraced(function* (target: Device, showing: Showing, notification: string) {
			const channel = yield* createChannel(target)
			const answer = yield* Effect.onError(
				sendToDevice(
					target,
					'liveactivity',
					{
						aps: {
							alert: startAlert(showing.journey),
							attributes: {url: `${BUNDLES[target.bundle].scheme}://booking/${showing.journey.id}`},
							'attributes-type': 'LiveActivityAttributes',
							'content-state': yield* contentState(showing.props),
							event: 'start',
							'input-push-channel': channel,
							'relevance-score': 100,
							timestamp: seconds(showing.now)
						}
					},
					10,
					notification
				),
				() => deleteChannel({bundle: target.bundle, channel})
			)
			if (accepted(answer)) return Result.succeed(channel)
			yield* deleteChannel({bundle: target.bundle, channel})
			if (!retryable(answer)) yield* pipe(forgetDevice(target), Reactivity.mutation(['push']), asPushSaveError)
			return Result.fail(answer)
		})

		// A refused start leaves the leg unstarted, so the next round tries again.
		const launch = Effect.fnUntraced(function* (target: Device, showing: Showing) {
			// Every trip uses the same push-to-start token, but a refusal belongs to this leg's notification only.
			const notification = `start ${target.bundle} ${Redacted.value(target.token)} ${showing.journey.id} ${showing.leg}`
			if (
				pipe(
					yield* Ref.get(retrying),
					HashMap.get(notification),
					Option.exists(pending => pending.until > showing.now)
				)
			) {
				return
			}
			const started = yield* pushStart(target, showing, notification)
			if (Result.isFailure(started)) return
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

		const finish = Effect.fnUntraced(function* (activity: Activity, now: number) {
			const answer = yield* Effect.result(
				broadcast(
					activity,
					{
						'content-state': yield* contentState(activity.props),
						'dismissal-date': seconds(now + 10 * MINUTE),
						event: 'end',
						timestamp: seconds(now)
					},
					10,
					now
				)
			)
			if (Result.isFailure(answer)) {
				yield* Effect.logWarning('An activity was not ended', Cause.fail(answer.failure))
				return
			}
			if (retryable(answer.success)) return
			yield* deleteChannel(activity)
			yield* pipe(
				activities.updateVoid({...editable(activity), endedAt: Option.some(now)}),
				Reactivity.mutation(['push']),
				asPushSaveError
			)
		})

		// A change APNs took or will always refuse is remembered; a throttled one is sent again next round.
		const refresh = Effect.fnUntraced(function* (activity: Activity, props: ActivityProps, now: number) {
			const shown = yield* contentState(activity.props)
			const next = yield* contentState(props)
			if (next.props === shown.props) return
			const answer = yield* broadcast(
				activity,
				{'content-state': next, event: 'update', timestamp: seconds(now)},
				Boolean.match(urgencyOf(activity.props) === urgencyOf(props), {
					onFalse: () => 10 as const,
					onTrue: () => 5 as const
				}),
				now
			)
			if (retryable(answer)) return
			// A refused channel means the activity is gone.
			yield* pipe(
				activities.updateVoid(
					Boolean.match(deadToken(answer), {
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
			now: number
		) {
			const showing = {journey, leg: window.leg, now, props: activityProps(journey, all, now), window} satisfies Showing
			// An activity that cannot cover the window ends, and the leg starts afresh.
			yield* pipe(
				yield* asPushReadError(listActivities()),
				Array.filter(
					activity =>
						activity.bookingId === journey.id &&
						activity.leg === window.leg &&
						Option.isNone(activity.endedAt) &&
						!holds(activity, window)
				),
				Effect.forEach(activity => finish(activity, now), {concurrency: 1, discard: true})
			)
			yield* Effect.forEach(
				showPlan(yield* asPushReadError(listDevices()), yield* asPushReadError(listActivities()), journey, window),
				action => {
					if (action._tag === 'launch') return launch(action.target, showing)
					return refresh(action.target, showing.props, now)
				},
				{concurrency: 1, discard: true}
			)
		})

		// A device whose token died leaves the list with its first failed alert.
		const notify = Effect.fnUntraced(function* (device: Device, alert: Alert, booking: Booking) {
			const answer = yield* sendToDevice(
				device,
				'alert',
				{
					aps: {alert: {body: alert.body, title: alert.title}, sound: 'default', 'thread-id': booking.id},
					bookingId: booking.id
				},
				10
			)
			if (accepted(answer)) return 'accepted' as const
			if (retryable(answer)) return 'retry' as const
			if (!deadToken(answer)) return 'refused' as const
			yield* pipe(forgetDevice(device), Reactivity.mutation(['push']), asPushSaveError)
			return 'dead' as const
		})

		const announce = Effect.fnUntraced(function* (booking: Booking, now: number) {
			const sent = Array.map(yield* asPushReadError(listSent(booking.id)), row => row.key)
			const fresh = Array.filter(alertsOf(booking, now), alert => !announced(sent, alert))
			if (Array.isReadonlyArrayEmpty(fresh)) return
			const devices = Array.filter(yield* asPushReadError(listDevices()), device => device.kind === 'alert')
			// An alert every device refused for now, such as a throttled one, is sent again next round.
			const done = yield* Effect.filter(
				fresh,
				alert =>
					pipe(
						devices,
						Effect.forEach(device => notify(device, alert, booking), {concurrency: 1}),
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
						recordSent(Array.map(alerts, alert => ({bookingId: booking.id, key: alertKey(alert), sentAt: now}))),
						Reactivity.mutation(['push']),
						asPushSaveError
					)
			})
		})

		const ticking = yield* Semaphore.make(1)
		const tick = pipe(
			Effect.gen(function* () {
				if (Option.isNone(signer)) return
				const now = yield* Clock.currentTimeMillis
				const all = yield* bookings.list
				yield* Effect.forEach(
					all,
					booking =>
						Effect.ignore(
							Effect.gen(function* () {
								yield* announce(booking, now)
								if (booking._tag === 'stay') return
								yield* Option.match(activeWindow(booking, now), {
									onNone: () => Effect.void,
									onSome: window => show(booking, window, all, now)
								})
							}),
							{log: 'Warn', message: `The Live Activity of ${booking.id} was not updated`}
						),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					expiredActivities(yield* asPushReadError(listActivities()), all, now),
					activity => finish(activity, now),
					{concurrency: 1, discard: true}
				)
				// Nothing reads an activity two days after it ended, or the alerts of a booking that left.
				yield* pipe(
					Effect.andThen(forgetEndedBefore(now - 2 * DAY), forgetSentExcept(Array.map(all, booking => booking.id))),
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
			}, withReactivity)
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
				})
			}),
			table: 'push_migrations'
		})
	)

	static readonly layer = Layer.provide(Layer.effect(this, this.make), this.migrations)
}
