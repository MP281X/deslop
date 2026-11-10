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
	HashMap,
	Layer,
	Option,
	Record,
	Redacted,
	Ref,
	Result,
	Schedule,
	Schema,
	Semaphore,
	Stream,
	String,
	SubscriptionRef,
	pipe
} from 'effect'

import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {Jwk, Jws} from 'effect/jose'
import {KeyValueStore} from 'effect/persistence'

import {ACTIVITY_NAME, activeWindow, activityProps, HOUR, MINUTE, urgencyOf} from '#services/bookings/lib/utils.ts'
import type {ActivityProps, Booking, BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {
	alertKey,
	alertsFor,
	announced,
	holds,
	showPlan,
	expiredActivities,
	retainPushState,
	startAlert
} from '#services/push/lib/utils.ts'
import type {Alert} from '#services/push/lib/utils.ts'
import type {ActivityClaim, ActivityRecord, ActivityToken, Bundle, Device} from '#services/push/schema.ts'
import {ActivityPropsJson, ApnsReason, JwtClaims, PushError, PushState} from '#services/push/schema.ts'

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
type LegOf = Pick<ActivityRecord, 'bookingId' | 'bundle' | 'leg'>
type Span = {end: number; start: number}
type Showing = {journey: Flight | Train; leg: Leg; now: number; props: ActivityProps; window: Span}

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

function sameLeg(record: LegOf, other: LegOf) {
	return record.bookingId === other.bookingId && record.leg === other.leg && record.bundle === other.bundle
}

function sameActivity(record: ActivityRecord, other: ActivityRecord) {
	return (
		sameLeg(record, other) &&
		record.claimedAt === other.claimedAt &&
		record.token === other.token &&
		record.channel === other.channel
	)
}

function failed(message: string) {
	return Effect.mapError((cause: unknown) => PushError.make({cause, message}))
}

function contentState(json: string) {
	return {name: ACTIVITY_NAME, props: json}
}

// Talks to Apple's push service directly: Expo's push service cannot send Live Activity updates.
export class Push extends Context.Service<
	Push,
	{
		readonly activity: (input: ActivityToken) => Effect.Effect<void, PushError>
		readonly claim: (input: ActivityClaim) => Effect.Effect<boolean, PushError>
		readonly register: (device: Device) => Effect.Effect<void, PushError>
	}
>()('@deslop/trips/services/push/service/Push') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const bookings = yield* Bookings
			const keyId = yield* Config.option(Config.String('APNS_KEY_ID'))
			const teamId = yield* Config.option(Config.String('APNS_TEAM_ID'))
			const privateKey = yield* Config.option(Config.Redacted('APNS_KEY'))
			const client = yield* HttpClient.HttpClient
			const store = KeyValueStore.toSchemaStore(yield* KeyValueStore.KeyValueStore, PushState)
			const state = yield* SubscriptionRef.make<PushState>(
				Option.getOrElse(yield* failed('The push state could not be read.')(store.get('push')), () => ({
					activities: [],
					devices: [],
					sent: {}
				}))
			)

			function save(change: (current: PushState) => PushState) {
				return Effect.uninterruptible(
					SubscriptionRef.updateEffect(state, current => {
						const next = change(current)
						if (next === current) return Effect.succeed(current)
						return Effect.as(failed('The push state could not be saved.')(store.set('push', next)), next)
					})
				)
			}

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
			const bearer = yield* Ref.make(Option.none<{at: number; token: string}>())
			const retrying = yield* Ref.make(HashMap.empty<string, {answer: Answer; until: number}>())

			const sign = Effect.fnUntraced(function* (now: number) {
				const found = yield* Effect.fromOption(signer)
				const token = Redacted.value(
					yield* Jws.sign(
						new TextEncoder().encode(yield* Schema.encodeEffect(JwtClaims)({iat: seconds(now), iss: found.teamId})),
						yield* signingKey,
						{kid: found.keyId}
					)
				)
				yield* Ref.set(bearer, Option.some({at: now, token}))
				return token
			})

			// APNs accepts a provider token for an hour and refuses one renewed more than every twenty minutes.
			const providerToken = pipe(
				Effect.gen(function* () {
					const now = yield* Clock.currentTimeMillis
					return yield* Option.match(
						Option.filter(yield* Ref.get(bearer), token => now - token.at < 40 * MINUTE),
						{onNone: () => sign(now), onSome: cached => Effect.succeed(cached.token)}
					)
				}),
				failed('The APNs key could not sign a token.')
			)

			const send = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest, notification?: string) {
				const now = yield* Clock.currentTimeMillis
				const key = notification ?? `${request.method} ${request.url} ${request.headers['apns-channel-id'] ?? ''}`
				const deferred = Option.getOrUndefined(
					Option.filter(HashMap.get(yield* Ref.get(retrying), key), pending => pending.until > now)
				)
				if (deferred !== undefined) return deferred.answer
				const response = yield* pipe(
					client.execute(HttpClientRequest.setHeader(request, 'authorization', `bearer ${yield* providerToken}`)),
					Effect.timeout('20 seconds'),
					failed('APNs did not answer.')
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

			function toDevice(
				target: Apns & {token: string},
				type: 'alert' | 'liveactivity',
				body: unknown,
				priority: 5 | 10,
				notification?: string
			) {
				return Effect.flatMap(
					HttpClientRequest.bodyJson(
						HttpClientRequest.post(`${BUNDLES[target.bundle].host}/3/device/${target.token}`, {
							headers: {
								'apns-priority': `${priority}`,
								'apns-push-type': type,
								'apns-topic': Boolean.match(type === 'liveactivity', {
									onFalse: () => target.bundle,
									onTrue: () => `${target.bundle}.push-type.liveactivity`
								})
							}
						}),
						body
					),
					request => send(request, notification)
				)
			}

			// Most recent message stored, so a phone offline in flight gets the latest state when it reconnects.
			const createChannel = Effect.fnUntraced(function* (target: Apns) {
				const answer = yield* send(
					yield* failed('The channel request could not be written.')(
						HttpClientRequest.bodyJson(
							HttpClientRequest.post(`${BUNDLES[target.bundle].channels}/1/apps/${target.bundle}/channels`),
							{'message-storage-policy': 1, 'push-type': 'LiveActivity'}
						)
					)
				)
				return yield* Effect.mapError(Effect.fromOption(answer.channel), () =>
					PushError.make({message: `APNs created no channel: ${answer.status}`})
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

			function update(record: ActivityRecord, aps: Record<string, unknown>, priority: 5 | 10, now: number) {
				if (record.token !== undefined) {
					return toDevice({...record, token: record.token}, 'liveactivity', {aps}, priority)
				}
				if (record.channel !== undefined) {
					return Effect.flatMap(
						HttpClientRequest.bodyJson(
							HttpClientRequest.post(`${BUNDLES[record.bundle].host}/4/broadcasts/apps/${record.bundle}`, {
								headers: {
									'apns-channel-id': record.channel,
									// The channel stores the latest message for a phone offline in flight, as long as an activity lives.
									'apns-expiration': `${seconds(now + 8 * HOUR)}`,
									'apns-priority': `${priority}`,
									'apns-push-type': 'liveactivity'
								}
							}),
							{aps}
						),
						send
					)
				}
				return Effect.succeed<Answer>({channel: Option.none(), reason: Option.none(), status: 0})
			}

			// Taken atomically, so the app's claim and the server's start never both show a leg.
			function reserve(record: ActivityRecord, window: Span) {
				return Effect.uninterruptible(
					SubscriptionRef.modifyEffect(state, current => {
						if (
							Array.some(current.activities, item => sameLeg(item, record) && holds(item, window, record.claimedAt))
						) {
							return Effect.succeed([false, current] as const)
						}
						const next = {
							...current,
							activities: [...Array.filter(current.activities, item => !sameLeg(item, record)), record]
						}
						return Effect.as(failed('The push state could not be saved.')(store.set('push', next)), [
							true,
							next
						] as const)
					})
				)
			}

			function release(record: ActivityRecord) {
				return Effect.ignore(
					save(current => ({
						...current,
						activities: Array.filter(
							current.activities,
							item =>
								!sameLeg(item, record) ||
								item.claimedAt !== record.claimedAt ||
								item.token !== undefined ||
								item.channel !== undefined
						)
					})),
					{log: 'Warn', message: 'A failed start kept its reservation until the claim times out'}
				)
			}

			const pushStart = Effect.fnUntraced(function* (target: Device, showing: Showing, notification: string) {
				const channel = yield* createChannel(target)
				const json = yield* Schema.encodeEffect(ActivityPropsJson)(showing.props)
				const answer = yield* Effect.onError(
					toDevice(
						target,
						'liveactivity',
						{
							aps: {
								alert: startAlert(showing.journey),
								attributes: {url: `${BUNDLES[target.bundle].scheme}://booking/${showing.journey.id}`},
								'attributes-type': 'LiveActivityAttributes',
								'content-state': contentState(json),
								event: 'start',
								'input-push-channel': channel,
								'relevance-score': 100,
								timestamp: seconds(showing.now)
							}
						},
						10,
						notification
					),
					() => deleteChannel({...target, channel})
				)
				if (accepted(answer)) return Result.succeed({channel, json})
				yield* deleteChannel({...target, channel})
				if (!retryable(answer)) {
					yield* save(current => ({
						...current,
						devices: Array.filter(current.devices, found => found.token !== target.token)
					}))
				}
				return Result.fail(answer)
			})

			const launch = Effect.fnUntraced(function* (target: Device, showing: Showing) {
				// Every trip uses the same push-to-start token, but a refusal belongs to this leg's notification only.
				const notification = `start ${target.bundle} ${target.token} ${showing.journey.id} ${showing.leg}`
				if (
					Option.exists(HashMap.get(yield* Ref.get(retrying), notification), pending => pending.until > showing.now)
				) {
					return
				}
				const reserved = {
					bookingId: showing.journey.id,
					bundle: target.bundle,
					claimedAt: showing.now,
					leg: showing.leg
				} satisfies ActivityRecord
				if (!(yield* reserve(reserved, showing.window))) return
				const started = yield* Effect.onError(pushStart(target, showing, notification), () => release(reserved))
				// A refused start leaves the leg free, so the app can still start it when opened.
				if (Result.isFailure(started)) return yield* release(reserved)
				yield* save(current => ({
					...current,
					activities: Array.map(current.activities, item => {
						if (!sameLeg(item, reserved) || item.claimedAt !== reserved.claimedAt) return item
						return {...item, channel: started.success.channel, props: started.success.json}
					})
				}))
			})

			const finish = Effect.fnUntraced(function* (record: ActivityRecord, now: number) {
				const answer = yield* Effect.result(
					update(
						record,
						{
							'content-state': Option.getOrUndefined(Option.map(Option.fromUndefinedOr(record.props), contentState)),
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
				if (record.channel !== undefined) yield* deleteChannel({...record, channel: record.channel})
				yield* save(current => ({
					...current,
					activities: Array.map(current.activities, item =>
						Boolean.match(sameActivity(item, record), {onFalse: () => item, onTrue: () => ({...item, endedAt: now})})
					)
				}))
			})

			// A change APNs took or will always refuse is remembered; a throttled one is sent again next round.
			const refresh = Effect.fnUntraced(function* (record: ActivityRecord, props: ActivityProps, now: number) {
				const json = yield* Schema.encodeEffect(ActivityPropsJson)(props)
				if (json === record.props) return
				const urgent = !Option.exists(
					Option.flatMap(Option.fromUndefinedOr(record.props), Schema.decodeUnknownOption(ActivityPropsJson)),
					old => urgencyOf(old) === urgencyOf(props)
				)
				const answer = yield* update(
					record,
					{'content-state': contentState(json), event: 'update', timestamp: seconds(now)},
					Boolean.match(urgent, {onFalse: () => 5 as const, onTrue: () => 10 as const}),
					now
				)
				if (retryable(answer)) return
				// A token the activity no longer holds means the person ended it; a record replaced meanwhile keeps its own state.
				yield* save(current => ({
					...current,
					activities: Array.map(current.activities, item => {
						if (!sameActivity(item, record)) {
							return item
						}
						if (deadToken(answer)) return {...item, endedAt: now}
						return {...item, props: json}
					})
				}))
			})

			const show = Effect.fnUntraced(function* (
				journey: Flight | Train,
				window: Span & {leg: Leg},
				all: BookingList,
				now: number
			) {
				const showing = {
					journey,
					leg: window.leg,
					now,
					props: activityProps(journey, all, now),
					window
				} satisfies Showing
				yield* Effect.forEach(
					Array.filter(
						(yield* SubscriptionRef.get(state)).activities,
						record =>
							record.bookingId === journey.id &&
							record.leg === window.leg &&
							record.endedAt === undefined &&
							(record.token !== undefined || record.channel !== undefined) &&
							!holds(record, window, now)
					),
					record => finish(record, now),
					{concurrency: 1, discard: true}
				)
				yield* Effect.forEach(
					showPlan(yield* SubscriptionRef.get(state), journey, window, now),
					action => {
						if (action._tag === 'launch') return launch(action.target, showing)
						return refresh(action.target, showing.props, now)
					},
					{concurrency: 1, discard: true}
				)
			})

			// A device whose token died leaves the list with its first failed alert.
			const notify = Effect.fnUntraced(function* (device: Device, alert: Alert, booking: Booking) {
				const answer = yield* toDevice(
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
				yield* save(current => ({
					...current,
					devices: Array.filter(current.devices, found => found.token !== device.token)
				}))
				return 'dead' as const
			})

			const announce = Effect.fnUntraced(function* (booking: Booking, now: number) {
				const current = yield* SubscriptionRef.get(state)
				const sent = Option.getOrElse(Record.get(current.sent, booking.id), () => Array.empty<string>())
				const fresh = Array.filter(alertsFor(booking, now), alert => !announced(sent, alert))
				if (Array.isReadonlyArrayEmpty(fresh)) return
				const devices = Array.filter(current.devices, device => device.kind === 'alert')
				// An alert every device refused for now, such as a throttled one, is sent again next round.
				const done = yield* Effect.filter(
					fresh,
					alert =>
						Effect.map(
							Effect.forEach(devices, device => notify(device, alert, booking), {concurrency: 1}),
							outcomes =>
								!Array.isReadonlyArrayNonEmpty(outcomes) || !Array.every(outcomes, outcome => outcome === 'retry')
						),
					{concurrency: 1}
				)
				if (Array.isReadonlyArrayEmpty(done)) return
				yield* save(latest => ({
					...latest,
					sent: Record.set(latest.sent, booking.id, [...sent, ...Array.map(done, alertKey)])
				}))
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
							pipe(
								Effect.gen(function* () {
									yield* announce(booking, now)
									if (booking._tag === 'stay') return
									yield* Option.match(activeWindow(booking, now), {
										onNone: () => Effect.void,
										onSome: window => show(booking, window, all, now)
									})
								}),
								Effect.ignore({log: 'Warn', message: `The Live Activity of ${booking.id} was not updated`})
							),
						{concurrency: 1, discard: true}
					)
					yield* Effect.forEach(
						expiredActivities(yield* SubscriptionRef.get(state), all, now),
						record => finish(record, now),
						{concurrency: 1, discard: true}
					)
					yield* save(current => retainPushState(current, all, now))
				}),
				Semaphore.withPermit(ticking),
				Effect.ignore({log: 'Warn', message: 'The push round failed'})
			)

			yield* Effect.forkScoped(Effect.repeat(tick, Schedule.spaced('30 seconds')))
			yield* Effect.forkScoped(
				pipe(
					bookings.changes,
					Stream.debounce('2 seconds'),
					Stream.runForEach(() => tick)
				)
			)

			return Push.of({
				activity: Effect.fn('Push.activity')(function* (input) {
					const now = yield* Clock.currentTimeMillis
					yield* save(current => ({
						...current,
						activities: [
							...Array.filter(current.activities, item => !sameLeg(item, input)),
							// A rotated token keeps the activity's start, which bounds its eight hours, and the state it last showed.
							Option.match(
								Array.findFirst(current.activities, item => sameLeg(item, input) && item.endedAt === undefined),
								{onNone: () => ({...input, claimedAt: now}), onSome: existing => ({...existing, ...input})}
							)
						]
					}))
				}),
				claim: Effect.fn('Push.claim')(function* (input) {
					const now = yield* Clock.currentTimeMillis
					return yield* reserve(
						{...input, claimedAt: now},
						pipe(
							Array.findFirst(
								yield* failed('The bookings could not be read.')(bookings.list),
								booking => booking.id === input.bookingId
							),
							Option.flatMap(booking => activeWindow(booking, now)),
							Option.filter(window => window.leg === input.leg),
							Option.getOrElse(() => ({end: 0, start: 0}) satisfies Span)
						)
					)
				}),
				register: Effect.fn('Push.register')(function* (device) {
					yield* save(current => {
						if (Array.some(current.devices, found => found.token === device.token && found.kind === device.kind)) {
							return current
						}
						return {
							...current,
							// One token per kind and app: a new one replaces the one it rotated from.
							devices: [
								...Array.filter(
									current.devices,
									found => !(found.kind === device.kind && found.bundle === device.bundle)
								),
								device
							]
						}
					})
				})
			})
		})
	)
}
