import {NodeCrypto} from '@effect/platform-node'
import {SqliteClient} from '@effect/sql-sqlite-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Clock,
	ConfigProvider,
	Context,
	Effect,
	Layer,
	Option,
	Queue,
	Redacted,
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
import {Reactivity} from 'effect/reactivity'
import {SqlClient, SqlSchema} from 'effect/sql'
import {TestClock} from 'effect/testing'

import {activityProps, HOUR} from '#services/bookings/lib/utils.ts'
import type {Booking} from '#services/bookings/schema.ts'
import {Flight} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Activity, Device, JwtClaims} from '#services/push/schema.ts'
import {Push} from '#services/push/service.ts'

const BOOKING = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d'
const OTHER = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5e'

const FLIGHT = {
	airline: 'British Airways',
	airlineCode: 'BA',
	arrives: 4 * HOUR,
	boardingAt: Option.none(),
	boardingGroup: Option.none(),
	confirmation: Option.none(),
	departs: 2 * HOUR,
	from: {code: 'FCO', name: 'Rome', timeZone: 'Europe/Rome'},
	id: BOOKING,
	live: Option.none(),
	number: '553',
	seat: Option.none(),
	status: 'confirmed',
	to: {code: 'LHR', name: 'London', timeZone: 'Europe/London'}
} as const

// A running activity the server started on a channel, for a booking no longer listed, so the first round ends it.
function running(bookingId: string, channel: string) {
	return Activity.insert.make({
		bookingId,
		bundle: 'xyz.mp281x.trips.dev',
		channel,
		endedAt: Option.none(),
		leg: 'departure',
		props: activityProps(Flight.make(FLIGHT), [], 0),
		startedAt: 0
	})
}

const open = Effect.fnUntraced(function* (
	answer: Effect.Effect<number>,
	seeded: readonly (typeof Activity.insert.Type)[] = [],
	list: Booking[] = []
) {
	const now = yield* Clock.currentTimeMillis
	const database = yield* Layer.build(Layer.merge(SqliteClient.layer({filename: ':memory:'}), Reactivity.layer))
	const sql = Context.get(database, SqlClient.SqlClient)
	yield* Layer.build(Layer.provide(Push.migrations, Layer.succeedContext(database)))
	yield* Effect.forEach(
		seeded,
		activity =>
			Effect.flatMap(
				Schema.encodeEffect(Activity.insert)(activity),
				row => sql`INSERT INTO activities ${sql.insert(row)}`
			),
		{concurrency: 1, discard: true}
	)
	const responses = yield* Ref.make(answer)
	const channels = yield* Ref.make(0)
	const calls = yield* Queue.unbounded<HttpClientRequest.HttpClientRequest>()
	const key = yield* (yield* Signature.Signature).generateKeyPair(Signature.ecdsaP256)
	const push = Context.get(
		yield* Layer.build(
			pipe(
				Push.layer,
				Layer.provide(Layer.succeedContext(database)),
				Layer.provide(
					Layer.succeed(
						Bookings,
						Bookings.of({
							events: Stream.never,
							list: Effect.succeed(list),
							remove: () => Effect.void,
							replace: () => Effect.undefined,
							save: () => Effect.undefined,
							watch: Stream.never
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
	const activities = SqlSchema.findAll({
		Request: Schema.Void,
		Result: Activity,
		execute: () => sql`SELECT * FROM activities ORDER BY bookingId`
	})
	const devices = SqlSchema.findAll({Request: Schema.Void, Result: Device, execute: () => sql`SELECT * FROM devices`})
	return {
		activities: activities(),
		calls,
		devices: devices(),
		key,
		now,
		push,
		responses,
		// The activities once they hold, read again after each commit of the push state.
		settled: (done: (current: Activity[]) => boolean) =>
			Effect.map(Stream.runHead(Stream.filter(sql.reactive(['push'], activities()), done)), Option.getOrThrow)
	}
})

function ended(activities: readonly Activity[], index: number) {
	return pipe(
		activities,
		pipelineSubject4972 => Array.get(pipelineSubject4972, index),
		Option.exists(activity => Option.isSome(activity.endedAt))
	)
}

it.layer(NodeCrypto.layer)(test => {
	test.effect(
		'signs the APNs bearer as an ES256 compact JWS the key verifies',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.succeed(200), [running(BOOKING, 'fixture-channel')])
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
			const first = Flight.make({...FLIGHT, arrives: now + 4 * HOUR, departs: now + 2 * HOUR})
			const second = Flight.make({
				...FLIGHT,
				arrives: now + 4 * HOUR,
				departs: now + 2 * HOUR,
				id: OTHER,
				number: '554'
			})
			const fixture = yield* open(
				pipe(
					yield* Ref.make(0),
					Ref.getAndUpdate(count => count + 1),
					Effect.map(count => Boolean.match(count === 0, {onFalse: () => 200, onTrue: () => 503}))
				),
				[],
				[first, second]
			)
			yield* fixture.push.register({
				bundle: 'xyz.mp281x.trips.dev',
				kind: 'start',
				token: Redacted.make('aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa')
			})
			// The token is stored for the server's own use: it never leaves in a JSON form and prints redacted.
			const device = Option.getOrThrow(Array.head(yield* fixture.devices))
			assert.isTrue(Redacted.isRedacted(device.token))
			assert.notProperty(yield* Schema.encodeEffect(Device.json)(device), 'token')
			yield* TestClock.adjust('30 seconds')
			assert.deepStrictEqual(
				Array.map(yield* fixture.settled(current => current.length === 1), activity => activity.bookingId),
				[OTHER]
			)
			const calls = yield* Queue.takeAll(fixture.calls)
			assert.strictEqual(
				Array.countBy(calls, request => String.includes('/3/device/')(request.url)),
				2
			)
			// The refused start's channel is deleted, and the next trip gets its own.
			assert.strictEqual(
				Array.countBy(calls, request => String.endsWith('/channels')(request.url)),
				3
			)
			yield* TestClock.adjust('30 seconds')
			assert.strictEqual(yield* Queue.size(fixture.calls), 0)
			yield* TestClock.adjust('870 seconds')
			assert.deepStrictEqual(
				Array.map(yield* fixture.settled(current => current.length === 2), activity => activity.bookingId),
				[BOOKING, OTHER]
			)
			assert.deepStrictEqual(
				Array.map(yield* Queue.takeAll(fixture.calls), request => request.method),
				['POST', 'POST']
			)
		})
	)

	for (const status of [429, 500, 503]) {
		test.effect(
			`retains a channel after APNs ${status} and ends it only after a later accepted send`,
			Effect.fnUntraced(function* () {
				const fixture = yield* open(Effect.succeed(status), [running(BOOKING, 'fixture-channel')])
				assert.strictEqual((yield* Queue.take(fixture.calls)).method, 'POST')
				assert.isFalse(ended(yield* fixture.activities, 0))
				assert.strictEqual(yield* Queue.size(fixture.calls), 0)
				yield* Ref.set(fixture.responses, Effect.succeed(200))
				yield* TestClock.adjust('30 seconds')
				if (status >= 500) {
					assert.strictEqual(yield* Queue.size(fixture.calls), 0)
					yield* TestClock.adjust('870 seconds')
				}
				assert.strictEqual((yield* Queue.take(fixture.calls)).method, 'POST')
				assert.strictEqual((yield* Queue.take(fixture.calls)).method, 'DELETE')
				const current = yield* fixture.settled(found => ended(found, 0))
				assert.deepStrictEqual(
					current[0]?.endedAt,
					Option.some(fixture.now + Boolean.match(status >= 500, {onFalse: () => 30_000, onTrue: () => 900_000}))
				)
			})
		)
	}

	test.effect(
		'retains an activity after a timed-out end request and retries on the next round',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.never, [running(BOOKING, 'fixture-channel')])
			yield* Queue.take(fixture.calls)
			yield* TestClock.adjust('20 seconds')
			assert.isFalse(ended(yield* fixture.activities, 0))
			yield* Ref.set(fixture.responses, Effect.succeed(200))
			yield* TestClock.adjust('30 seconds')
			yield* Queue.take(fixture.calls)
			assert.deepStrictEqual(
				(yield* fixture.settled(found => ended(found, 0)))[0]?.endedAt,
				Option.some(fixture.now + 50_000)
			)
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
				[running(BOOKING, 'first-channel'), running(OTHER, 'second-channel')]
			)
			yield* Queue.take(fixture.calls)
			yield* TestClock.adjust('20 seconds')
			assert.isFalse(ended(yield* fixture.settled(found => ended(found, 1)), 0))
		})
	)

	test.effect(
		'retires a refused channel without sending its end again',
		Effect.fnUntraced(function* () {
			const fixture = yield* open(Effect.succeed(410), [running(BOOKING, 'fixture-channel')])
			assert.deepStrictEqual((yield* fixture.settled(found => ended(found, 0)))[0]?.endedAt, Option.some(fixture.now))
			yield* Queue.takeAll(fixture.calls)
			yield* TestClock.adjust('30 seconds')
			assert.strictEqual(yield* Queue.size(fixture.calls), 0)
		})
	)
})
