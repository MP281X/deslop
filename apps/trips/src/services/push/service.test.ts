import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
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

import {BookedPlace, BookingId, Flight} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Push} from '#services/push/service.ts'

const ID = BookingId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
const OTHER = BookingId.make('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e')
function starter(bundle: string, token: string) {
	return {bundle, kind: 'start' as const, token: Redacted.make(ApnsToken.make(String.repeat(64)(token)))}
}
const STARTER = starter('xyz.mp281x.trips', 'a')
const DEV_STARTER = starter('xyz.mp281x.trips.dev', 'b')
const ANSWER = {channel: Option.none(), reason: Option.none(), status: 503}

// A flight four hours out, which only a person's request starts.
function flightAt(now: DateTime.Utc, id: BookingId, seat: Option.Option<string>) {
	return Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(now, Duration.hours(5)),
		boardingAt: Option.none(),
		boardingGroup: Option.none(),
		confirmation: Option.none(),
		departs: DateTime.addDuration(now, Duration.hours(4)),
		from: Schema.decodeSync(BookedPlace)({code: 'FCO', name: 'Fiumicino', timeZone: 'Europe/Rome'}),
		id,
		live: Option.none(),
		number: '553',
		seat,
		status: 'confirmed',
		to: Schema.decodeSync(BookedPlace)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'})
	})
}
const booked = Effect.map(DateTime.now, now => [flightAt(now, ID, Option.none())])
const seated = Effect.map(DateTime.now, now => [flightAt(now, ID, Option.some('12B'))])
const both = Effect.map(DateTime.now, now => [flightAt(now, ID, Option.none()), flightAt(now, OTHER, Option.none())])

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

// Apple accepts every start and end and keeps every channel its delete is asked for; `update` is what it answers an update.
const running = Effect.fnUntraced(function* (update: ApnsAnswer) {
	const asked = yield* Queue.unbounded<string>()
	const created = MutableRef.make(0)
	const layer = Layer.mock(Apns, {
		broadcast: (_bundle, _channel, aps) =>
			Effect.succeed(
				Boolean.match(aps['event'] === 'update', {
					onFalse: () => ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200}),
					onTrue: () => update
				})
			),
		createChannel: () => Effect.sync(() => `c${MutableRef.incrementAndGet(created)}`),
		deleteChannel: Effect.fnUntraced(function* (_bundle: string, channel: string) {
			yield* Queue.offer(asked, channel)
			return ApnsAnswer.cases.Retry.make(ANSWER)
		}),
		enabled: true,
		startActivity: () => Effect.succeed(ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200})),
		startHeld: () => Effect.succeedNone
	})
	return {asked, created, layer}
})

// A start of a booking that is not there waits for the round holding the push service, so the round that began with the server has ended when it fails.
const afterRound = Effect.flatMap(Push, push => Effect.flip(push.start(OTHER)))

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
			yield* serve(folder, (yield* apple([], yield* open)).layer, booked, startUnaccepted)
			// The flight left while the server was down; the channel Apple kept for it did not.
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
			yield* serve(folder, (yield* apple([], yield* open, 'fails')).layer, booked, startUnaccepted)
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
				booked,
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
				booked,
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
				booked,
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

	test.effect(
		'a channel Apple kept after its ended activity was replaced does not hold the start of another flight',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const kept = yield* running(ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200}))
			yield* serve(
				folder,
				kept.layer,
				booked,
				Effect.flatMap(Push, push => Effect.andThen(push.register(STARTER), push.start(ID)))
			)
			// The flight left while the server was down, and the end Apple took left its channel to delete.
			assert.strictEqual(yield* serve(folder, kept.layer, Effect.succeed([]), Queue.take(kept.asked)), 'c1')
			yield* serve(
				folder,
				kept.layer,
				both,
				Effect.flatMap(Push, push => Effect.andThen(push.start(ID), push.start(OTHER)))
			)
			assert.strictEqual(MutableRef.get(kept.created), 3)
		})
	)

	test.effect(
		'a leg whose channel Apple answers is gone starts on a new channel in the next round',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const kept = yield* running(ApnsAnswer.cases.ChannelGone.make({...ANSWER, status: 400}))
			yield* serve(
				folder,
				kept.layer,
				booked,
				Effect.flatMap(Push, push => Effect.andThen(push.register(STARTER), push.start(ID)))
			)
			// The first round of this run shows the new seat on the channel Apple answers is gone.
			yield* serve(folder, kept.layer, seated, afterRound)
			assert.strictEqual(MutableRef.get(kept.created), 1)
			yield* serve(folder, kept.layer, seated, afterRound)
			assert.strictEqual(MutableRef.get(kept.created), 2)
		})
	)
})
