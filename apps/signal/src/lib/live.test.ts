// oxlint-disable-next-line effecttsgo/node-builtin-import -- The atom transport contract needs a real scoped HTTP/WebSocket server.
import {createServer} from 'node:http'

import {NodeHttpServer, NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Boolean, Context, Effect, Fiber, Layer, MutableList, Option, Stream, SubscriptionRef, pipe} from 'effect'
import type {Predicate} from 'effect'

import {HttpRouter, HttpServer, HttpServerResponse} from 'effect/http'
import {AtomRegistry} from 'effect/reactivity'
import type {AsyncResult, Atom} from 'effect/reactivity'

import {Auth} from '@deslop/runtime/auth/service'
import {DEVELOPER} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {historyAtom, threadFeedAtom, usageAtom} from '#lib/utils.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import type {Entry, Experience, UsageLedger} from '#services/game/schema.ts'
import {GameError} from '#services/game/schema.ts'
import {Game} from '#services/game/service.ts'

function valueWhere<A, E>(
	registry: AtomRegistry.AtomRegistry,
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>,
	matches: Predicate.Predicate<A>
) {
	return pipe(
		AtomRegistry.toStreamResult(registry, atom),
		Stream.filter(matches),
		Stream.runHead,
		Effect.flatMap(Effect.fromOption)
	)
}

function quiet<A, E, R>(stream: Stream.Stream<A, E, R>) {
	return pipe(
		stream,
		Stream.runHead,
		// oxlint-disable-next-line @deslop/coding-standards/no-test-timeout -- A bounded absence is the assertion: no idle polling or one-second domain retry, not a hang guard.
		Effect.timeoutOption('1200 millis'),
		Effect.map(Option.isNone)
	)
}

const server = Effect.fnUntraced(function* () {
	const revision = yield* SubscriptionRef.make(1)
	const usage = yield* SubscriptionRef.make(Option.some<UsageLedger>({groups: {}, since: 1}))
	const calls = yield* SubscriptionRef.make({changes: 0, historical: 0, history: 0, thread: 0, usage: 0})
	const sockets = MutableList.make<() => void>()
	const node = createServer()
	node.on('upgrade', (_request, socket) =>
		MutableList.append(sockets, () => {
			socket.destroy()
		})
	)
	const game = Game.of({
		control: () => Effect.succeed({coreConfigured: false, localDecisions: false, running: false}),
		history: (_actor, before) =>
			Effect.gen(function* () {
				yield* SubscriptionRef.update(calls, current => ({
					...current,
					historical: current.historical + Boolean.match(Option.isSome(before), {onFalse: () => 0, onTrue: () => 1}),
					history: current.history + 1
				}))
				if (Option.isSome(before)) return []
				const id = yield* SubscriptionRef.get(revision)
				return [{actor: 1, id, kind: 'observe', text: `event ${id}`, tick: id, x: 0, z: 0}] satisfies Experience[]
			}),
		join: Stream.never,
		replay: () => Stream.never,
		revisions: Stream.onStart(
			SubscriptionRef.changes(revision),
			SubscriptionRef.update(calls, current => ({...current, changes: current.changes + 1}))
		),
		status: Stream.never,
		thread: team =>
			Effect.gen(function* () {
				yield* SubscriptionRef.update(calls, current => ({...current, thread: current.thread + 1}))
				if (team !== 0) return []
				const round = yield* SubscriptionRef.get(revision)
				return [
					{commands: [], notices: [], observation: '', round, status: 'done', team, text: `round ${round}`, tick: round}
				] satisfies Entry[]
			}),
		timeline: Effect.succeed({live: 0, marks: [], start: 0}),
		usage: pipe(
			SubscriptionRef.changes(usage),
			Stream.mapEffect(value =>
				pipe(
					Effect.fromOption(value),
					Effect.mapError(() => GameError.make({message: 'Usage unavailable'}))
				)
			),
			Stream.onStart(SubscriptionRef.update(calls, current => ({...current, usage: current.usage + 1})))
		)
	})
	const context = yield* Layer.build(
		pipe(
			HttpRouter.serve(
				pipe(
					Layer.mergeAll(
						ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
						HttpRouter.add(
							'GET',
							'/api/runtime',
							HttpServerResponse.jsonUnsafe({name: 'signal', traces: '', version: '0.1.0'})
						)
					),
					Layer.provide(Layer.succeed(Game, game)),
					Layer.provide(
						Layer.succeedContext(
							Auth.makeContext(
								Auth.of({access: () => Effect.succeed(DEVELOPER), user: () => Effect.succeed(DEVELOPER)})
							)
						)
					)
				)
			),
			Layer.provide(ServerRuntime.layerProtocol),
			Layer.provideMerge(NodeHttpServer.layer(() => node, {host: '127.0.0.1', port: 0}))
		)
	)
	const url = HttpServer.formatAddress(Context.get(context, HttpServer.HttpServer).address)
	yield* Effect.addFinalizer(() =>
		Effect.sync(() => {
			for (const close of MutableList.toArray(sockets)) close()
		})
	)
	/* oxlint-disable no-restricted-globals, no-restricted-properties -- Node supplies no browser origin. Install only location.origin for the real web client and restore the original descriptor with its scope. */
	const previous = Object.getOwnPropertyDescriptor(globalThis, 'location')
	yield* Effect.acquireRelease(
		Effect.sync(() => Object.defineProperty(globalThis, 'location', {configurable: true, value: {origin: url}})),
		() =>
			Effect.sync(() => {
				if (previous === undefined) Reflect.deleteProperty(globalThis, 'location')
				else Object.defineProperty(globalThis, 'location', previous)
			})
	)
	/* oxlint-enable no-restricted-globals, no-restricted-properties */
	return {
		calls,
		drop: Effect.sync(() => {
			for (const close of MutableList.toArray(sockets)) close()
		}),
		revision,
		usage
	}
})

it.layer(NodeServices.layer, {excludeTestServices: true})(test => {
	test.effect(
		'keeps the real history, thread and usage atoms live across a dropped WebSocket',
		Effect.fnUntraced(function* () {
			const fixture = yield* server()
			const registry = yield* Effect.acquireRelease(
				Effect.sync(() => AtomRegistry.make()),
				value => Effect.sync(() => value.dispose())
			)
			const live = historyAtom('all:0')
			const historical = historyAtom('all:1')
			yield* Effect.acquireRelease(
				Effect.sync(() => [
					registry.mount(live),
					registry.mount(historical),
					registry.mount(threadFeedAtom),
					registry.mount(usageAtom)
				]),
				readers =>
					Effect.sync(() => {
						for (const close of readers) close()
					})
			)
			yield* AtomRegistry.getResult(registry, live)
			const frozen = yield* AtomRegistry.getResult(registry, historical)
			yield* AtomRegistry.getResult(registry, threadFeedAtom)
			yield* AtomRegistry.getResult(registry, usageAtom)
			assert.deepStrictEqual(yield* SubscriptionRef.get(fixture.calls), {
				changes: 1,
				historical: 1,
				history: 3,
				thread: 3,
				usage: 1
			})
			assert.isTrue(yield* quiet(pipe(SubscriptionRef.changes(fixture.calls), Stream.drop(1))))
			yield* SubscriptionRef.set(fixture.revision, 2)
			yield* valueWhere(registry, live, rows => Array.some(rows, row => row.id === 2))
			yield* valueWhere(registry, threadFeedAtom, feed =>
				Array.some(feed.entries, row => row.kind === 'core' && row.value.round === 2)
			)
			assert.strictEqual(yield* AtomRegistry.getResult(registry, historical), frozen)
			assert.strictEqual((yield* SubscriptionRef.get(fixture.calls)).historical, 1)
			yield* SubscriptionRef.set(fixture.usage, Option.some({groups: {}, since: 2}))
			yield* valueWhere(registry, usageAtom, value => value.since === 2)
			assert.strictEqual((yield* SubscriptionRef.get(fixture.calls)).usage, 1)
			yield* fixture.drop
			yield* pipe(
				SubscriptionRef.changes(fixture.calls),
				Stream.filter(value => value.changes === 2 && value.usage === 2),
				Stream.runHead
			)
			yield* SubscriptionRef.set(fixture.revision, 3)
			yield* valueWhere(registry, live, rows => Array.some(rows, row => row.id === 3))
			yield* valueWhere(registry, threadFeedAtom, feed =>
				Array.some(feed.entries, row => row.kind === 'core' && row.value.round === 3)
			)
			const failure = yield* Effect.forkScoped(Stream.runDrain(AtomRegistry.toStreamResult(registry, usageAtom)))
			yield* SubscriptionRef.set(fixture.usage, Option.none())
			assert.strictEqual((yield* Effect.flip(Fiber.join(failure)))._tag, 'GameError')
			assert.isTrue(
				yield* quiet(
					pipe(
						SubscriptionRef.changes(fixture.calls),
						Stream.filter(value => value.usage > 2)
					)
				)
			)
		})
	)
})
