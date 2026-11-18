import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	DateTime,
	Deferred,
	Duration,
	Effect,
	FileSystem,
	Layer,
	MutableRef,
	Option,
	Queue,
	Redacted,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {Apns} from '@deslop/runtime/server/apns'
import {layerDataStore} from '@deslop/runtime/server/store'
import {ApnsAnswer, ApnsError, ApnsToken} from '@deslop/runtime/shared/apns'

import {BookedPlace, BookingId, Train} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Push} from '#services/push/service.ts'

const ID = BookingId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
function starter(bundle: string, token: string) {
	return {bundle, kind: 'start' as const, token: Redacted.make(ApnsToken.make(String.repeat(64)(token)))}
}
const STARTER = starter('xyz.mp281x.trips', 'a')
const DEV_STARTER = starter('xyz.mp281x.trips.dev', 'b')
const ANSWER = {channel: Option.none(), reason: Option.none(), status: 503}

// A train three hours out, which only a person's request starts.
const journey = Effect.map(DateTime.now, now => [
	Train.make({
		arrives: DateTime.addDuration(now, Duration.hours(4)),
		coach: Option.none(),
		confirmation: Option.none(),
		departs: DateTime.addDuration(now, Duration.hours(3)),
		from: Schema.decodeSync(BookedPlace)({name: 'Milano', timeZone: 'Europe/Rome'}),
		id: ID,
		issued: Option.none(),
		live: Option.none(),
		number: '2',
		operator: 'Trenitalia',
		seat: Option.none(),
		service: 'IC 2',
		status: 'confirmed',
		stops: [],
		to: Schema.decodeSync(BookedPlace)({name: 'Verona', timeZone: 'Europe/Rome'})
	})
])

type StartOutcome = typeof StartOutcome.Type
const StartOutcome = Schema.Literals(['fails', 'hangs'])

// Apple names a new channel for each start and accepts none; the start of `how` errors, or never answers, instead. Each channel delete is queued for the test to read, waits for `gate`, and is done only for the channels in `deleted`, retried for the rest.
const apple = Effect.fnUntraced(function* (
	deleted: readonly string[],
	gate: Deferred.Deferred<void>,
	how?: StartOutcome
) {
	const asked = yield* Queue.unbounded<string>()
	const created = MutableRef.make(0)
	const sent = yield* Deferred.make<void>()
	const layer = Layer.mock(Apns, {
		createChannel: () => Effect.sync(() => `c${MutableRef.incrementAndGet(created)}`),
		deleteChannel: (_, channel) =>
			Effect.gen(function* () {
				yield* Queue.offer(asked, channel)
				yield* Deferred.await(gate)
				if (Array.contains(deleted, channel)) return ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200})
				return ApnsAnswer.cases.Retry.make(ANSWER)
			}),
		enabled: true,
		startActivity: () =>
			Effect.suspend(() => {
				if (how === 'fails') return ApnsError.make({message: 'APNs did not answer.'})
				if (how === 'hangs') return Effect.andThen(Deferred.succeed(sent, undefined), Effect.never)
				return Effect.succeed(ApnsAnswer.cases.Retry.make(ANSWER))
			}),
		startHeld: () => Effect.succeedNone
	})
	return {asked, created, layer, sent}
})

const open = Effect.tap(Deferred.make<void>(), gate => Deferred.succeed(gate, undefined))

// One run of the server on the folder, stopped when `body` ends; its first round has read the bookings before `body` acts, so the round never races a person's request.
const serve = Effect.fnUntraced(function* <A, E>(
	folder: string,
	apns: Layer.Layer<Apns>,
	list: Bookings['Service']['list'],
	body: Effect.Effect<A, E, Push>
) {
	const listed = yield* Deferred.make<void>()
	const context = yield* Layer.build(
		pipe(
			Push.layer,
			Layer.provide(apns),
			Layer.provide(
				Layer.mock(Bookings, {list: Effect.tap(list, () => Deferred.succeed(listed, undefined)), watch: Stream.never})
			),
			Layer.provide(layerDataStore(folder))
		)
	)
	yield* Deferred.await(listed)
	return yield* Effect.provideContext(body, context)
}, Effect.scoped)

const startUnaccepted = Effect.flatMap(Push, push =>
	Effect.andThen(push.register(STARTER), Effect.flip(push.start(ID)))
)

// Real time, and real files, so a restart reopens the database the last run wrote.
it.layer(NodeServices.layer, {excludeTestServices: true})(test => {
	test.effect(
		'a channel Apple kept for a start it did not accept is deleted after every restart until Apple answers',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			yield* serve(folder, (yield* apple([], yield* open)).layer, journey, startUnaccepted)
			// The journey left while the server was down; the channel Apple kept for it did not.
			const throttled = yield* apple([], yield* open)
			assert.strictEqual(yield* serve(folder, throttled.layer, Effect.succeed([]), Queue.take(throttled.asked)), 'c1')
			const answered = yield* apple(['c1'], yield* open)
			assert.strictEqual(yield* serve(folder, answered.layer, Effect.succeed([]), Queue.take(answered.asked)), 'c1')
		})
	)

	test.effect(
		'a channel of a start that failed after Apple created it is deleted after a restart',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			yield* serve(folder, (yield* apple([], yield* open, 'fails')).layer, journey, startUnaccepted)
			const answered = yield* apple(['c1'], yield* open)
			assert.strictEqual(yield* serve(folder, answered.layer, Effect.succeed([]), Queue.take(answered.asked)), 'c1')
		})
	)

	test.effect(
		'a channel whose start Trips stopped before Apple answered is deleted after a restart',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const hanging = yield* apple([], yield* open, 'hangs')
			yield* serve(
				folder,
				hanging.layer,
				journey,
				Effect.gen(function* () {
					const push = yield* Push
					yield* push.register(STARTER)
					yield* Effect.forkChild(push.start(ID))
					yield* Deferred.await(hanging.sent)
				})
			)
			const answered = yield* apple(['c1'], yield* open)
			assert.strictEqual(yield* serve(folder, answered.layer, Effect.succeed([]), Queue.take(answered.asked)), 'c1')
		})
	)

	test.effect(
		'no channel is made for an app while one that never started is still owed its delete',
		Effect.fnUntraced(function* () {
			const throttled = yield* apple([], yield* open)
			yield* serve(
				yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				throttled.layer,
				journey,
				Effect.andThen(
					startUnaccepted,
					Effect.forEach(Array.range(1, 3), () => startUnaccepted, {concurrency: 1, discard: true})
				)
			)
			assert.strictEqual(MutableRef.get(throttled.created), 1)
		})
	)

	test.effect(
		'retirements written while the worker is busy are all claimed by its next pass',
		Effect.fnUntraced(function* () {
			const gate = yield* Deferred.make<void>()
			const throttled = yield* apple([], gate)
			yield* serve(
				yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(),
				throttled.layer,
				journey,
				Effect.gen(function* () {
					yield* startUnaccepted
					assert.strictEqual(yield* Queue.take(throttled.asked), 'c1')
					// Another app has its own channel, which the first one's wait does not hold.
					yield* Effect.andThen((yield* Push).register(DEV_STARTER), Effect.flip((yield* Push).start(ID)))
					yield* Deferred.succeed(gate, undefined)
					assert.deepStrictEqual(yield* Queue.takeBetween(throttled.asked, 2, 2), ['c1', 'c2'])
				})
			)
		})
	)
})
