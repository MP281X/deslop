import {NodeCrypto} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Deferred,
	Effect,
	Layer,
	Option,
	Queue,
	Ref,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {KeyFormat, Signature} from 'effect/crypto'
import {Base64} from 'effect/encoding'
import {HttpClient, HttpClientResponse} from 'effect/http'
import type {HttpClientRequest} from 'effect/http'
import {Jwk, Jws} from 'effect/jose'
import {KeyValueStore} from 'effect/persistence'
import {TestClock} from 'effect/testing'

import {HOUR} from '#services/bookings/lib/utils.ts'
import {Flight} from '#services/bookings/schema.ts'
import type {BookingList} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {JwtClaims, PushState} from '#services/push/schema.ts'
import type {ActivityRecord} from '#services/push/schema.ts'
import {Push} from '#services/push/service.ts'

const TOKEN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const TOKEN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
const RECORD = {
	bookingId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d',
	bundle: 'xyz.mp281x.trips.dev',
	claimedAt: 0,
	leg: 'departure'
} satisfies ActivityRecord

function open(
	answer: Effect.Effect<number>,
	record?: ActivityRecord,
	following: ActivityRecord[] = [],
	list: BookingList = []
) {
	return Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		const base = Context.get(yield* Layer.build(Layer.fresh(KeyValueStore.layerMemory)), KeyValueStore.KeyValueStore)
		const saved = KeyValueStore.toSchemaStore(base, PushState)
		yield* saved.set('push', {
			activities: [...Option.toArray(Option.fromUndefinedOr(record)), ...following],
			devices: [],
			sent: {}
		})
		const responses = yield* Ref.make(answer)
		const channels = yield* Ref.make(0)
		const calls = yield* Queue.unbounded<HttpClientRequest.HttpClientRequest>()
		const commits = yield* Queue.unbounded<PushState>()
		const key = yield* (yield* Signature.Signature).generateKeyPair(Signature.ecdsaP256)
		const store = KeyValueStore.make({
			...base,
			set: (name, value) =>
				Effect.gen(function* () {
					yield* base.set(name, value)
					if (name === 'push') {
						yield* Queue.offer(commits, yield* Effect.orDie(Effect.flatMap(saved.get(name), Effect.fromOption)))
					}
				})
		})
		const push = Context.get(
			yield* Layer.build(
				pipe(
					Push.layer,
					Layer.provide(Layer.succeed(KeyValueStore.KeyValueStore, store)),
					Layer.provide(
						Layer.succeed(
							Bookings,
							Bookings.of({
								changes: Stream.never,
								events: Stream.never,
								list: Effect.succeed(list),
								remove: () => Effect.void,
								restore: () => Effect.void,
								save: () => Effect.succeed([]),
								update: () => Effect.void
							})
						)
					),
					Layer.provide(
						Layer.succeed(
							HttpClient.HttpClient,
							HttpClient.make(request =>
								Effect.gen(function* () {
									yield* Queue.offer(calls, request)
									if (request.method === 'POST' && String.endsWith('/channels')(request.url)) {
										return HttpClientResponse.fromWeb(
											request,
											new Response(undefined, {
												headers: {'apns-channel-id': `channel-${yield* Ref.updateAndGet(channels, count => count + 1)}`}
											})
										)
									}
									return HttpClientResponse.fromWeb(
										request,
										new Response(undefined, {status: yield* Effect.flatten(Ref.get(responses))})
									)
								})
							)
						)
					),
					Layer.provide(
						ConfigProvider.layer(
							ConfigProvider.fromUnknown({
								APNS_KEY: Base64.encode(yield* KeyFormat.encode(KeyFormat.pkcs8, key.privateKey)),
								APNS_KEY_ID: 'fixture',
								APNS_TEAM_ID: 'fixture'
							})
						)
					)
				)
			),
			Push
		)
		return {calls, commits, key, now, push, responses, snapshot: Effect.flatMap(saved.get('push'), Effect.fromOption)}
	})
}

it.layer(NodeCrypto.layer)(test => {
	test.effect(
		'signs the APNs bearer as an ES256 compact JWS the key verifies',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.succeed(200), {...RECORD, token: TOKEN_A})
			const request = yield* Queue.take(fixture.calls)
			const verified = yield* Jws.verify(
				String.slice('bearer '.length)(request.headers['authorization'] ?? ''),
				yield* Jwk.importSpki(yield* KeyFormat.encode(KeyFormat.spki, fixture.key.publicKey), 'ES256')
			)
			const claims = yield* Effect.fromOption(
				Schema.decodeOption(JwtClaims)(new TextDecoder().decode(verified.payload))
			)
			assert.deepStrictEqual(
				[verified.protectedHeader.alg, verified.protectedHeader.kid, claims.iss, claims.iat],
				['ES256', 'fixture', 'fixture', Math.floor(fixture.now / 1000)]
			)
		})
	)

	test.effect(
		'retries a refused start without blocking another trip or churning its broadcast channels',
		Effect.fnUntraced(function* () {
			const now = yield* Clock.currentTimeMillis
			const first = Flight.make({
				airline: 'British Airways',
				airlineCode: 'BA',
				arrives: now + 4 * HOUR,
				createdAt: now,
				departs: now + 2 * HOUR,
				from: {code: 'FCO', name: 'Rome', timeZone: 'Europe/Rome'},
				id: RECORD.bookingId,
				number: '553',
				sources: [],
				status: 'confirmed',
				to: {code: 'LHR', name: 'London', timeZone: 'Europe/London'}
			})
			const second = {...first, id: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e', number: '554'}
			const fixture = yield* open(
				Effect.map(
					Ref.getAndUpdate(yield* Ref.make(0), count => count + 1),
					count => {
						if (count === 0) return 503
						return 200
					}
				),
				undefined,
				[],
				[first, second]
			)
			yield* fixture.push.register({bundle: RECORD.bundle, kind: 'start', token: TOKEN_A})
			yield* TestClock.adjust('30 seconds')
			const calls = yield* Queue.takeAll(fixture.calls)
			assert.strictEqual(
				Array.countBy(calls, request => String.includes('/3/device/')(request.url)),
				2
			)
			assert.strictEqual(
				Array.countBy(calls, request => String.endsWith('/channels')(request.url)),
				3
			)
			assert.isTrue(
				Array.some(
					(yield* fixture.snapshot).activities,
					record => record.bookingId === second.id && record.channel !== undefined
				)
			)
			yield* TestClock.adjust('30 seconds')
			assert.strictEqual(yield* Queue.size(fixture.calls), 0)
			yield* TestClock.adjust('870 seconds')
			assert.deepStrictEqual(
				Array.map(yield* Queue.takeAll(fixture.calls), request => request.method),
				['POST', 'POST']
			)
			assert.isTrue(Array.every((yield* fixture.snapshot).activities, record => record.channel !== undefined))
		})
	)

	for (const status of [429, 500, 503]) {
		test.effect(
			`retains a channel after APNs ${status} and ends it only after a later accepted send`,
			Effect.fnUntraced(function* () {
				const fixture = yield* open(Effect.succeed(status), {...RECORD, channel: 'fixture-channel'})
				assert.strictEqual((yield* Queue.take(fixture.calls)).method, 'POST')
				assert.isUndefined((yield* Queue.take(fixture.commits)).activities[0]?.endedAt)
				assert.strictEqual(yield* Queue.size(fixture.calls), 0)
				yield* Ref.set(fixture.responses, Effect.succeed(200))
				yield* TestClock.adjust('30 seconds')
				if (status >= 500) {
					assert.strictEqual(yield* Queue.size(fixture.calls), 0)
					yield* TestClock.adjust('870 seconds')
				}
				assert.strictEqual((yield* Queue.take(fixture.calls)).method, 'POST')
				assert.strictEqual((yield* Queue.take(fixture.calls)).method, 'DELETE')
				const ended = yield* Effect.flatMap(
					Stream.runHead(
						Stream.filter(Stream.fromQueue(fixture.commits), state => state.activities[0]?.endedAt !== undefined)
					),
					Effect.fromOption
				)
				assert.strictEqual(
					ended.activities[0]?.endedAt,
					fixture.now + Boolean.match(status >= 500, {onFalse: () => 30_000, onTrue: () => 900_000})
				)
			})
		)
	}

	test.effect(
		'retains an activity after a timed-out end request and retries on the next round',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.never, {...RECORD, token: TOKEN_A})
			yield* Queue.take(fixture.calls)
			yield* TestClock.adjust('20 seconds')
			assert.isUndefined((yield* fixture.snapshot).activities[0]?.endedAt)
			yield* Ref.set(fixture.responses, Effect.succeed(200))
			yield* TestClock.adjust('30 seconds')
			yield* Queue.take(fixture.calls)
			assert.strictEqual(
				(yield* Effect.flatMap(
					Stream.runHead(
						Stream.filter(Stream.fromQueue(fixture.commits), state => state.activities[0]?.endedAt !== undefined)
					),
					Effect.fromOption
				)).activities[0]?.endedAt,
				fixture.now + 50_000
			)
		})
	)

	test.effect(
		'does not mark a replacement token ended when an earlier token finishes in flight',
		Effect.fnUntraced(function* () {
			const response = yield* Deferred.make<number>()
			const fixture = yield* open(Deferred.await(response), {...RECORD, token: TOKEN_A})
			yield* Queue.take(fixture.calls)
			yield* fixture.push.activity({...RECORD, token: TOKEN_B})
			yield* Queue.take(fixture.commits)
			yield* Deferred.succeed(response, 200)
			const current = (yield* Queue.take(fixture.commits)).activities[0]
			assert.strictEqual(current?.token, TOKEN_B)
			assert.strictEqual(current?.claimedAt, RECORD.claimedAt)
			assert.isUndefined(current?.endedAt)
		})
	)

	test.effect(
		'continues ending other activities after one target times out',
		Effect.fnUntraced(function* () {
			const attempts = yield* Ref.make(0)
			const fixture = yield* open(
				Effect.gen(function* () {
					if ((yield* Ref.getAndUpdate(attempts, count => count + 1)) === 0) return yield* Effect.never
					return 200
				}),
				{...RECORD, token: TOKEN_A},
				[{...RECORD, bookingId: '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e', token: TOKEN_B}]
			)
			yield* Queue.take(fixture.calls)
			yield* TestClock.adjust('20 seconds')
			assert.strictEqual(yield* Queue.size(fixture.calls), 1)
			const committed = yield* Queue.take(fixture.commits)
			assert.isUndefined(committed.activities[0]?.endedAt)
			assert.isNumber(committed.activities[1]?.endedAt)
		})
	)

	test.effect(
		'retires a dead token without sending its end again',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.succeed(410), {...RECORD, token: TOKEN_A})
			yield* Queue.take(fixture.calls)
			assert.strictEqual((yield* Queue.take(fixture.commits)).activities[0]?.endedAt, fixture.now)
			yield* TestClock.adjust('30 seconds')
			assert.strictEqual(yield* Queue.size(fixture.calls), 0)
		})
	)

	test.effect(
		'does not reuse an old target’s retry window after its activity token rotates',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.succeed(503), {...RECORD, token: TOKEN_A})
			assert.isTrue(String.endsWith(TOKEN_A)((yield* Queue.take(fixture.calls)).url))
			yield* Queue.take(fixture.commits)
			yield* Ref.set(fixture.responses, Effect.succeed(200))
			yield* fixture.push.activity({...RECORD, token: TOKEN_B})
			yield* Queue.take(fixture.commits)
			yield* TestClock.adjust('30 seconds')
			assert.isTrue(String.endsWith(TOKEN_B)((yield* Queue.take(fixture.calls)).url))
			assert.strictEqual((yield* Queue.take(fixture.commits)).activities[0]?.endedAt, fixture.now + 30_000)
		})
	)

	test.effect(
		'starts a new activity lifetime instead of retaining an ended record and its channel',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.succeed(200), {...RECORD, channel: 'old-channel', endedAt: 0, token: TOKEN_A})
			yield* Queue.take(fixture.commits)
			yield* TestClock.adjust('1 second')
			yield* fixture.push.activity({...RECORD, token: TOKEN_B})
			assert.deepStrictEqual((yield* fixture.snapshot).activities, [
				{...RECORD, claimedAt: fixture.now + 1000, token: TOKEN_B}
			])
		})
	)
})
