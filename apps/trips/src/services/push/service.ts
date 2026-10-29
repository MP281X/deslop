import {NodeHttpClient} from '@effect/platform-node'
import Undici from '@effect/platform-node/Undici'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
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

import {KeyFormat, Signature} from 'effect/crypto'
import {Base64, Base64Url} from 'effect/encoding'
import {HttpClient, HttpClientRequest, HttpClientResponse} from 'effect/http'
import {KeyValueStore} from 'effect/persistence'

import {
	ACTIVITY_LIFETIME,
	ACTIVITY_NAME,
	activeWindow,
	activityProps,
	alertsFor,
	DAY,
	HOUR,
	MINUTE,
	startAlert,
	urgencyOf
} from '#services/bookings/lib/utils.ts'
import type {Alert} from '#services/bookings/lib/utils.ts'
import type {ActivityProps, Booking, BookingList, Flight, Leg, Train} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import type {ActivityClaim, ActivityRecord, ActivityToken, Bundle, Device} from '#services/push/schema.ts'
import {ActivityPropsJson, ApnsReason, JwtPart, PushError, PushState} from '#services/push/schema.ts'

type Apns = {bundle: Bundle}
type Answer = {channel: Option.Option<string>; reason: Option.Option<string>; status: number}
type LegOf = Pick<ActivityRecord, 'bookingId' | 'bundle' | 'leg'>
type Span = {end: number; start: number}
// One journey leg to show in its current window.
type Showing = {journey: Flight | Train; leg: Leg; now: number; props: ActivityProps; window: Span}

// The store build pushes through production and the Simulator build through the sandbox; a TestFlight app cannot report it.
function host(bundle: Bundle) {
	if (bundle === 'xyz.mp281x.trips') return 'https://api.push.apple.com'
	return 'https://api.sandbox.push.apple.com'
}

function channels(bundle: Bundle) {
	if (bundle === 'xyz.mp281x.trips') return 'https://api-manage-broadcast.push.apple.com:2196'
	return 'https://api-manage-broadcast.sandbox.push.apple.com:2195'
}

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

// Each app, release and Simulator build, shows its own activity of a leg.
function sameLeg(record: LegOf, other: LegOf) {
	return record.bookingId === other.bookingId && record.leg === other.leg && record.bundle === other.bundle
}

// A leg stays taken by an activity that lives to the window's end and did not end before it opened, or a claim not yet given up.
function holds(record: ActivityRecord, window: Span, now: number) {
	if (record.claimedAt + ACTIVITY_LIFETIME < window.end) return false
	if (record.endedAt !== undefined) return record.endedAt >= window.start
	return record.token !== undefined || record.channel !== undefined || now - record.claimedAt < 2 * MINUTE
}

// A gate, platform or belt that changes back is news again; a delay step or a one-off is announced once.
function announced(sent: PushState['sent'][string], key: string) {
	const category = Array.headNonEmpty(String.split(':')(key))
	if (category === key || category === 'delay') return Array.contains(sent, key)
	return Option.exists(
		Array.findLast(sent, found => String.startsWith(`${category}:`)(found)),
		found => found === key
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
			// APNs speaks only HTTP/2, which Node's fetch does not; the server bundle keeps only Undici's default export, so the agent comes from it.
			const client = Context.get(
				yield* Layer.build(
					Layer.provide(
						NodeHttpClient.layerUndiciNoDispatcher,
						Layer.effect(
							NodeHttpClient.Dispatcher,
							Effect.acquireRelease(
								Effect.sync(() => new Undici.Agent({allowH2: true})),
								agent => Effect.promise(() => agent.destroy())
							)
						)
					)
				),
				HttpClient.HttpClient
			)
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
					// The .p8 file's body, with or without its PEM lines.
					const der = yield* Result.match(
						Base64.decode(String.replaceAll(/-----[^-]+-----|\\n|\s/gu, '')(Redacted.value(found.privateKey))),
						{onFailure: Effect.fail, onSuccess: Effect.succeed}
					)
					return yield* KeyFormat.decodePrivate(KeyFormat.pkcs8, Signature.ecdsaP256, der)
				})
			)
			const signature = yield* Signature.Signature
			const bearer = yield* Ref.make(Option.none<{at: number; token: string}>())

			const sign = Effect.fnUntraced(function* (now: number) {
				const found = yield* Effect.fromOption(signer)
				const input = `${Base64Url.encode(yield* Schema.encodeEffect(JwtPart)({alg: 'ES256', kid: found.keyId}))}.${Base64Url.encode(yield* Schema.encodeEffect(JwtPart)({iat: seconds(now), iss: found.teamId}))}`
				const token = `${input}.${Base64Url.encode(yield* signature.sign(yield* signingKey, new TextEncoder().encode(input)))}`
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

			const send = Effect.fnUntraced(function* (request: HttpClientRequest.HttpClientRequest) {
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
				return {
					channel: Option.fromNullishOr(response.headers['apns-channel-id']),
					reason,
					status: response.status
				} satisfies Answer
			})

			function toDevice(
				target: Apns & {token: string},
				type: 'alert' | 'liveactivity',
				body: unknown,
				priority: 5 | 10
			) {
				return Effect.flatMap(
					HttpClientRequest.bodyJson(
						HttpClientRequest.post(`${host(target.bundle)}/3/device/${target.token}`, {
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
					send
				)
			}

			// Most recent message stored, so a phone offline in flight gets the latest state when it reconnects.
			const createChannel = Effect.fnUntraced(function* (target: Apns) {
				const answer = yield* send(
					yield* failed('The channel request could not be written.')(
						HttpClientRequest.bodyJson(
							HttpClientRequest.post(`${channels(target.bundle)}/1/apps/${target.bundle}/channels`),
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
						HttpClientRequest.delete(`${channels(target.bundle)}/1/apps/${target.bundle}/channels`, {
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
							HttpClientRequest.post(`${host(record.bundle)}/4/broadcasts/apps/${record.bundle}`, {
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

			// Accepted, the start is a channel the server updates; refused, the channel goes, and a token Apple will refuse again leaves until the app registers it anew.
			const pushStart = Effect.fnUntraced(function* (target: Device, showing: Showing) {
				const channel = yield* createChannel(target)
				const json = yield* Schema.encodeEffect(ActivityPropsJson)(showing.props)
				const answer = yield* Effect.onError(
					toDevice(
						target,
						'liveactivity',
						{
							aps: {
								alert: startAlert(showing.journey),
								attributes: {
									url: `${{'xyz.mp281x.trips': 'trips', 'xyz.mp281x.trips.dev': 'trips-dev'}[target.bundle]}://booking/${showing.journey.id}`
								},
								'attributes-type': 'LiveActivityAttributes',
								'content-state': contentState(json),
								event: 'start',
								'input-push-channel': channel,
								'relevance-score': 100,
								timestamp: seconds(showing.now)
							}
						},
						10
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

			// The server starts an activity the app has not, through the push-to-start token and a channel for its updates.
			const launch = Effect.fnUntraced(function* (target: Device, showing: Showing) {
				const reserved = {
					bookingId: showing.journey.id,
					bundle: target.bundle,
					claimedAt: showing.now,
					leg: showing.leg
				} satisfies ActivityRecord
				if (!(yield* reserve(reserved, showing.window))) return
				const started = yield* Effect.onError(pushStart(target, showing), () => release(reserved))
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
				yield* Effect.ignore(
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
					),
					{log: 'Warn', message: 'An activity was not ended'}
				)
				if (record.channel !== undefined) yield* deleteChannel({...record, channel: record.channel})
				yield* save(current => ({
					...current,
					activities: Array.map(current.activities, item =>
						Boolean.match(sameLeg(item, record), {onFalse: () => item, onTrue: () => ({...item, endedAt: now})})
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
						if (
							!sameLeg(item, record) ||
							item.claimedAt !== record.claimedAt ||
							item.token !== record.token ||
							item.channel !== record.channel
						) {
							return item
						}
						if (deadToken(answer)) return {...item, endedAt: now}
						return {...item, props: json}
					})
				}))
			})

			// Each app shows the leg once; a given-up claim goes to the server, and an activity a delay outlived is replaced.
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
				function mine(record: ActivityRecord) {
					return record.bookingId === journey.id && record.leg === window.leg
				}
				yield* Effect.forEach(
					Array.filter(
						(yield* SubscriptionRef.get(state)).activities,
						record =>
							mine(record) &&
							record.endedAt === undefined &&
							(record.token !== undefined || record.channel !== undefined) &&
							!holds(record, window, now)
					),
					record => finish(record, now),
					{concurrency: 1, discard: true}
				)
				const current = yield* SubscriptionRef.get(state)
				const starters = Array.filter(current.devices, device => device.kind === 'start')
				const records = Array.filter(current.activities, item => mine(item) && holds(item, window, now))
				yield* Effect.forEach(
					Array.dedupe([...Array.map(starters, device => device.bundle), ...Array.map(records, item => item.bundle)]),
					bundle =>
						Option.match(
							Array.findFirst(records, item => item.bundle === bundle),
							{
								onNone: () =>
									Option.match(
										Array.findFirst(starters, device => device.bundle === bundle),
										{onNone: () => Effect.void, onSome: target => launch(target, showing)}
									),
								onSome: record => {
									if (record.endedAt !== undefined || (record.token === undefined && record.channel === undefined)) {
										return Effect.void
									}
									return refresh(record, showing.props, now)
								}
							}
						),
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
				const fresh = Array.filter(alertsFor(booking, now), alert => !announced(sent, alert.key))
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
					sent: Record.set(latest.sent, booking.id, [...sent, ...Array.map(done, alert => alert.key)])
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
					// Activities whose leg is over, whose booking is gone or which ended long ago.
					yield* Effect.forEach(
						Array.filter((yield* SubscriptionRef.get(state)).activities, record => {
							if (record.endedAt !== undefined) return false
							return !Option.exists(
								Array.findFirst(all, item => item.id === record.bookingId),
								found => Option.exists(activeWindow(found, now), window => window.leg === record.leg)
							)
						}),
						record => finish(record, now),
						{concurrency: 1, discard: true}
					)
					yield* save(current => ({
						...current,
						activities: Array.filter(
							current.activities,
							record => record.endedAt === undefined || now - record.endedAt < 2 * DAY
						),
						sent: Record.filter(current.sent, (_keys, id) => Array.some(all, booking => booking.id === id))
					}))
				}),
				Semaphore.withPermit(ticking),
				Effect.ignore({log: 'Warn', message: 'The push round failed'})
			)

			yield* Effect.forkScoped(Effect.repeat(tick, Schedule.spaced('30 seconds')))
			// A new booking or a provider's change shows on the island within seconds.
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
								Array.findFirst(current.activities, item => sameLeg(item, input)),
								{onNone: () => ({...input, claimedAt: now}), onSome: existing => ({...existing, ...input})}
							)
						]
					}))
				}),
				// The app may start an activity itself only for a leg nobody started in its current window.
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
