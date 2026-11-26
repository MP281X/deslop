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
	Struct,
	pipe
} from 'effect'

import {Apns} from '@deslop/runtime/server/apns'
import {layerDataStore} from '@deslop/runtime/server/store'
import {ApnsAnswer, ApnsError, ApnsToken} from '@deslop/runtime/shared/apns'

import {FlightId, Flight, FlightTracking, Place, PhoneId} from '#contracts'

import {Flights} from '#server/flights/service.ts'
import {Push} from '#server/push/service.ts'

const ID = FlightId.make('1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d')
const OTHER = FlightId.make('2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e')
function starter(bundle: string, token: string) {
	return {
		bundle,
		kind: 'start' as const,
		phone: PhoneId.make('phone-a'),
		token: Redacted.make(ApnsToken.make(String.repeat(64)(token)))
	}
}
const STARTER = starter('xyz.mp281x.trips', 'a')
const DEV_STARTER = starter('xyz.mp281x.trips.dev', 'b')
const ANSWER = {channel: Option.none(), reason: Option.none(), status: 503}

// A flight two hours out unless told otherwise, inside the three hours its Live Activity shows.
function flightAt(
	now: DateTime.Utc,
	id: FlightId,
	seat: Option.Option<string>,
	timeZone = 'Europe/Rome',
	departsIn = Duration.hours(2)
) {
	return Flight.make({
		airline: 'British Airways',
		airlineCode: 'BA',
		arrives: DateTime.addDuration(now, Duration.sum(departsIn, Duration.hours(1))),
		boardingAt: Option.none(),
		departs: DateTime.addDuration(now, departsIn),
		from: Schema.decodeSync(Place)({code: 'FCO', name: 'Fiumicino', timeZone}),
		id,
		live: Option.none(),
		number: '553',
		to: Schema.decodeSync(Place)({code: 'LHR', name: 'Heathrow', timeZone: 'Europe/London'}),
		travellers: [
			{
				boardingGroup: Option.none(),
				boardingPass: false,
				confirmation: Option.none(),
				name: Option.none(),
				seat,
				status: 'confirmed',
				ticket: Option.none()
			}
		]
	})
}
const booked = Effect.map(DateTime.now, now => [flightAt(now, ID, Option.none())])
// The same flight four hours out, before its Live Activity shows, from an airport whose clock reads midday now, so the plan it owes is never held for the morning, whenever the test runs.
const bookedAtMidday = Effect.map(DateTime.now, now => {
	const hours = 12 - DateTime.toParts(now).hour
	const timeZone = Boolean.match(hours < 0, {onFalse: () => `Etc/GMT-${hours}`, onTrue: () => `Etc/GMT+${-hours}`})
	return [flightAt(now, ID, Option.none(), timeZone, Duration.hours(4))]
})
const seated = Effect.map(DateTime.now, now => [flightAt(now, ID, Option.some('12B'))])
// The same flight with its gate posted just now.
const gated = Effect.map(DateTime.now, now => [
	Flight.make({
		...Struct.pick(flightAt(now, ID, Option.some('12B')), Struct.keys(Flight.fields)),
		live: Option.some(
			Schema.decodeSync(FlightTracking)({
				checkedAt: DateTime.toEpochMillis(now),
				departureGate: 'B12',
				state: 'scheduled'
			})
		)
	})
])
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

// Apple accepts every start and end and keeps every channel its delete is asked for; `update` is what it answers an update, and `updated` is done once it has.
const running = Effect.fnUntraced(function* (update: ApnsAnswer) {
	const asked = yield* Queue.unbounded<string>()
	const created = MutableRef.make(0)
	const updated = yield* Deferred.make<void>()
	const layer = Layer.mock(Apns, {
		broadcast: (_bundle, _channel, aps) =>
			Boolean.match(aps['event'] === 'update', {
				onFalse: () => Effect.succeed(ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200})),
				onTrue: () => Effect.as(Deferred.succeed(updated, undefined), update)
			}),
		createChannel: () => Effect.sync(() => `c${MutableRef.incrementAndGet(created)}`),
		deleteChannel: Effect.fnUntraced(function* (_bundle: string, channel: string) {
			yield* Queue.offer(asked, channel)
			return ApnsAnswer.cases.Retry.make(ANSWER)
		}),
		enabled: true,
		startActivity: () => Effect.succeed(ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200})),
		startHeld: () => Effect.succeedNone
	})
	return {asked, created, layer, updated}
})

type Titled = typeof Titled.Type
const Titled = Schema.Struct({title: Schema.String})

// Apple accepts everything but a notification to a token in `dead`, which it answers is unregistered; the alert title of each activity update, and the token and title of each notification, are kept for the test to read.
function telling(dead: readonly string[] = []) {
	const told = MutableRef.make(Array.empty<string>())
	const sent = MutableRef.make(Array.empty<readonly [string, string]>())
	const created = MutableRef.make(0)
	const accepted = ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200})
	const layer = Layer.mock(Apns, {
		broadcast: (_bundle, _channel, aps) =>
			Effect.sync(() => {
				Option.map(Schema.decodeUnknownOption(Titled)(aps['alert']), alert =>
					MutableRef.update(told, Array.append(alert.title))
				)
				return accepted
			}),
		createChannel: () => Effect.sync(() => `c${MutableRef.incrementAndGet(created)}`),
		deleteChannel: () => Effect.succeed(accepted),
		enabled: true,
		sendToDevice: (target, _type, body) =>
			Effect.sync(() => {
				Option.map(Schema.decodeUnknownOption(Titled)(body.aps['alert']), alert =>
					MutableRef.update(sent, Array.append([Redacted.value(target.token), alert.title] as const))
				)
				if (!Array.contains(dead, Redacted.value(target.token))) return accepted
				return ApnsAnswer.cases.DeadToken.make({...ANSWER, reason: Option.some('Unregistered'), status: 410})
			}),
		startActivity: () => Effect.succeed(accepted),
		startHeld: () => Effect.succeedNone
	})
	return {layer, sent, told}
}

const open = Effect.tap(Deferred.make<void>(), gate => Deferred.succeed(gate, undefined))

// One run of the server on the folder, stopped when `body` ends; its first round has read the flights before `body` acts, and a registration in `body` runs its own round after it.
const serve = Effect.fnUntraced(function* <A, E>(
	folder: string,
	apns: Layer.Layer<Apns>,
	list: Flights['Service']['list'],
	body: Effect.Effect<A, E, Push>
) {
	const listed = yield* Deferred.make<void>()
	const context = yield* Layer.build(
		pipe(
			Push.layer,
			Layer.provide(apns),
			Layer.provide(
				Layer.mock(Flights, {
					list: Effect.tap(list, () => Deferred.succeed(listed, undefined)),
					travel: Effect.succeed([]),
					watch: Stream.never
				})
			),
			Layer.provide(layerDataStore(folder))
		)
	)
	yield* Deferred.await(listed)
	return yield* Effect.provideContext(body, context)
}, Effect.scoped)

// The phone registers, and the round that follows starts the flight's Live Activity on it.
const registered = Effect.flatMap(Push, push => push.register(STARTER))

// Real time, and real files, so a restart reopens the database the last run wrote.
it.layer(NodeServices.layer, {excludeTestServices: true})(test => {
	test.effect(
		'a channel Apple kept for a start it did not accept is deleted after every restart until Apple answers',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			yield* serve(folder, (yield* apple([], yield* open)).layer, booked, registered)
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
			yield* serve(folder, (yield* apple([], yield* open, 'fails')).layer, booked, registered)
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
					yield* Effect.forkChild(push.register(STARTER))
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
					registered,
					Effect.forEach(Array.range(1, 3), () => registered, {concurrency: 1, discard: true})
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
					yield* registered
					assert.strictEqual(yield* Queue.take(throttled.asked), 'c1')
					// Another app has its own channel, which the first one's wait does not hold.
					yield* (yield* Push).register(DEV_STARTER)
					yield* Deferred.succeed(gate, undefined)
					assert.deepStrictEqual(yield* Queue.takeBetween(throttled.asked, 2, 2), ['c1', 'c2'])
				})
			)
		})
	)

	test.effect(
		'a channel Apple kept after its ended activity does not hold the start of another flight',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const kept = yield* running(ApnsAnswer.cases.Accepted.make({...ANSWER, status: 200}))
			yield* serve(folder, kept.layer, booked, registered)
			// The flight left while the server was down, and the end Apple took left its channel to delete.
			assert.strictEqual(yield* serve(folder, kept.layer, Effect.succeed([]), Queue.take(kept.asked)), 'c1')
			// The flight back, its ended activity stays ended; the other flight starts on a channel of its own.
			yield* serve(folder, kept.layer, both, registered)
			assert.strictEqual(MutableRef.get(kept.created), 2)
		})
	)

	test.effect(
		'the check-in reminder and the plan due while no phone is registered reach the first phone registered after them',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const standIn = telling()
			const phone = {...STARTER, kind: 'alert' as const}
			// The iPhone registers its Live Activity token first, and the round after it has no phone to tell.
			yield* serve(folder, standIn.layer, bookedAtMidday, registered)
			assert.deepStrictEqual(MutableRef.get(standIn.sent), [])
			// Notifications turned on later, the round after the registration tells what is still owed.
			yield* serve(
				folder,
				standIn.layer,
				bookedAtMidday,
				Effect.flatMap(Push, push => push.register(phone))
			)
			assert.deepStrictEqual(MutableRef.get(standIn.sent), [
				[Redacted.value(phone.token), 'Check in for BA 553'],
				[Redacted.value(phone.token), 'BA 553 · Fiumicino → Heathrow']
			])
		})
	)

	test.effect(
		'the check-in reminder and the plan a dead token never took reach the next phone registered',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const dead = {...STARTER, kind: 'alert' as const, token: Redacted.make(ApnsToken.make(String.repeat(64)('d')))}
			const phone = {...STARTER, kind: 'alert' as const, phone: PhoneId.make('phone-b')}
			const standIn = telling([Redacted.value(dead.token)])
			yield* serve(
				folder,
				standIn.layer,
				bookedAtMidday,
				Effect.flatMap(Push, push => push.register(dead))
			)
			yield* serve(
				folder,
				standIn.layer,
				bookedAtMidday,
				Effect.flatMap(Push, push => push.register(phone))
			)
			// The dead token is forgotten with the first alert it was sent, so the plan goes to no phone in the first run.
			assert.deepStrictEqual(MutableRef.get(standIn.sent), [
				[Redacted.value(dead.token), 'Check in for BA 553'],
				[Redacted.value(phone.token), 'Check in for BA 553'],
				[Redacted.value(phone.token), 'BA 553 · Fiumicino → Heathrow']
			])
		})
	)

	test.effect(
		'a gate a running Live Activity tells reaches the other iPhone as a notification, and only the other',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const standIn = telling()
			const mine = {...STARTER, kind: 'alert' as const, token: Redacted.make(ApnsToken.make(String.repeat(64)('d')))}
			const other = {
				...STARTER,
				kind: 'alert' as const,
				phone: PhoneId.make('phone-b'),
				token: Redacted.make(ApnsToken.make(String.repeat(64)('c')))
			}
			// Both iPhones register, and the island starts on the first one.
			yield* serve(
				folder,
				standIn.layer,
				booked,
				Effect.flatMap(Push, push =>
					Effect.forEach([mine, other, STARTER], device => push.register(device), {concurrency: 1, discard: true})
				)
			)
			yield* serve(folder, standIn.layer, gated, registered)
			assert.deepStrictEqual(
				[
					MutableRef.get(standIn.told),
					Array.filter(MutableRef.get(standIn.sent), pair => String.includes('Gate')(pair[1]))
				],
				[['BA 553 · Gate B12'], [[Redacted.value(other.token), 'BA 553 · Gate B12']]]
			)
		})
	)

	test.effect(
		'a leg whose channel Apple answers is gone starts on a new channel in the next round',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const kept = yield* running(ApnsAnswer.cases.ChannelGone.make({...ANSWER, status: 400}))
			yield* serve(folder, kept.layer, booked, registered)
			// The first round of this run shows the new seat on the channel Apple answers is gone, and starts nothing; the round after it starts the leg again.
			yield* serve(
				folder,
				kept.layer,
				seated,
				Effect.gen(function* () {
					yield* Deferred.await(kept.updated)
					assert.strictEqual(MutableRef.get(kept.created), 1)
					yield* registered
					assert.strictEqual(MutableRef.get(kept.created), 2)
				})
			)
		})
	)
})
