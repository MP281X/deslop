import {assert, it} from '@effect/vitest'

import {
	Array,
	DateTime,
	Deferred,
	Duration,
	Effect,
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
import {ApnsAnswer, ApnsToken} from '@deslop/runtime/shared/apns'

import {BookedPlace, BookingId, Train} from '#services/bookings/schema.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Push} from '#services/push/service.ts'
import {scratchFolder, scratchStore} from '#services/scratch-store.ts'

const ID = BookingId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
const STARTER = {
	bundle: 'xyz.mp281x.trips',
	kind: 'start' as const,
	token: Redacted.make(ApnsToken.make(String.repeat(64)('a')))
}
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

// Apple names a new channel for each start and accepts none; each channel delete is queued for the test to read, waits for `gate`, and is done only for the channels in `deleted`, retried for the rest.
const apple = Effect.fnUntraced(function* (deleted: readonly string[], gate: Deferred.Deferred<void>) {
	const asked = yield* Queue.unbounded<string>()
	const started = MutableRef.make(0)
	const layer = Layer.mock(Apns, {
		deleteChannel: (_, channel) =>
			Effect.gen(function* () {
				yield* Queue.offer(asked, channel)
				yield* Deferred.await(gate)
				if (Array.contains(deleted, channel)) return ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200})
				return ApnsAnswer.cases.Retry.make(ANSWER)
			}),
		enabled: true,
		startActivity: () =>
			Effect.sync(() =>
				ApnsAnswer.cases.Retry.make({...ANSWER, channel: Option.some(`c${MutableRef.incrementAndGet(started)}`)})
			)
	})
	return {asked, layer}
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
			Layer.provide(scratchStore(folder))
		)
	)
	yield* Deferred.await(listed)
	return yield* Effect.provideContext(body, context)
}, Effect.scoped)

const startUnaccepted = Effect.flatMap(Push, push =>
	Effect.andThen(push.register(STARTER), Effect.flip(push.start(ID)))
)

it.live(
	'a channel Apple kept for a start it did not accept is deleted after a restart, and forgotten once Apple answers',
	Effect.fnUntraced(function* () {
		const folder = yield* scratchFolder
		yield* serve(
			folder,
			(yield* apple([], yield* open)).layer,
			journey,
			Effect.andThen(startUnaccepted, startUnaccepted)
		)
		// The journey left while the server was down; the channels Apple kept for it did not.
		const answered = yield* apple(['c1'], yield* open)
		assert.deepStrictEqual(
			yield* serve(folder, answered.layer, Effect.succeed([]), Queue.takeBetween(answered.asked, 2, 2)),
			['c1', 'c2']
		)
		const again = yield* apple([], yield* open)
		assert.strictEqual(yield* serve(folder, again.layer, Effect.succeed([]), Queue.take(again.asked)), 'c2')
	})
)

it.live(
	'retirements written while the worker is busy are all claimed by its next pass',
	Effect.fnUntraced(function* () {
		const gate = yield* Deferred.make<void>()
		const throttled = yield* apple([], gate)
		yield* serve(
			yield* scratchFolder,
			throttled.layer,
			journey,
			Effect.gen(function* () {
				yield* startUnaccepted
				assert.strictEqual(yield* Queue.take(throttled.asked), 'c1')
				yield* Effect.forEach(Array.range(2, 4), () => startUnaccepted, {concurrency: 1, discard: true})
				yield* Deferred.succeed(gate, undefined)
				assert.deepStrictEqual(yield* Queue.takeBetween(throttled.asked, 4, 4), ['c1', 'c2', 'c3', 'c4'])
				// Apple asked to retry, so every channel stays and the next signal finds all of them.
				yield* startUnaccepted
				assert.deepStrictEqual(yield* Queue.takeBetween(throttled.asked, 5, 5), ['c1', 'c2', 'c3', 'c4', 'c5'])
			})
		)
	})
)
