import {Array, Effect, HashMap, Option, Order, Redacted, Schema, Semaphore, Stream, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import type {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {registerPushToken} from '@deslop/runtime/client/push'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import type {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {Account} from '@deslop/runtime/shared/schema'

import {byChapterNumber, keyOf, RpcContracts} from '#contracts'
import type {ChapterBundle, ChapterKey, Position, ReadingChapter, ReadingPosition} from '#contracts'

const reduceChapters = listReducer<ReadingChapter, ChapterKey>(Order.flip(byChapterNumber), keyOf)

interface OpmRpc {
	readonly OpmRpc: unique symbol
}

export function catalogue(
	protocol: ReturnType<typeof layerSocketProtocol>,
	sessionAccount: Atom.Atom<AsyncResult.AsyncResult<Account, unknown>>
) {
	const RpcClient = AtomRpc.Service<OpmRpc>()('@deslop/opm/Catalogue', {
		group: RpcContracts.middleware(RpcStream),
		protocol
	})
	const chaptersAtom = RpcClient.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				Stream.unwrap(RpcClient.use(client => Effect.succeed(client('chapters.events', undefined)))),
				Stream.scan(
					() => Array.empty<ReadingChapter>(),
					(chapters, event) => reduceChapters(chapters, {...event, removed: []})
				),
				Stream.drop(1)
			),
			reconnectOnDrop
		)
	)

	// A place a disconnected write could not save belongs to the account that turned the page.
	const placesByAccountAtoms = Atom.family((_account: UserId) =>
		Atom.keepAlive(Atom.make(HashMap.empty<ChapterKey, Position>()))
	)

	const unsavedAtom = Atom.make(get =>
		Option.match(AsyncResult.value(get(sessionAccount)), {
			onNone: () => HashMap.empty<ChapterKey, Position>(),
			onSome: account => get(placesByAccountAtoms(account.id))
		})
	)

	const writePermit = Semaphore.makeUnsafe(1)

	const readingWritesAtom = Atom.keepAlive(
		Atom.fn(
			(updates: readonly (typeof ReadingPosition.json.Type)[], get) =>
				Effect.gen(function* () {
					const places = Option.map(AsyncResult.value(get(sessionAccount)), account => placesByAccountAtoms(account.id))
					function keep(
						update: (current: HashMap.HashMap<ChapterKey, Position>) => HashMap.HashMap<ChapterKey, Position>
					) {
						return Effect.sync(() => Option.map(places, atom => get.set(atom, update(get(atom)))))
					}
					const context = yield* get.result(RpcClient.runtime)
					yield* writePermit.withPermit(
						Effect.forEach(
							updates,
							update =>
								pipe(
									Effect.flatMap(RpcClient, client => client('chapters.write', update)),
									Effect.provideContext(context),
									writeOutcome,
									Effect.tap(() => keep(HashMap.remove(keyOf(update)))),
									Effect.tapErrorTag('WriteError', () =>
										keep(HashMap.set(keyOf(update), {done: update.done, page: update.page}))
									),
									Effect.ignore({log: 'Warn', message: 'The reading position was not saved'})
								),
							{concurrency: 1, discard: true}
						)
					)
				}),
			{concurrent: true}
		)
	)

	function registerToken(value: string, bundle: ChapterBundle) {
		return Effect.gen(function* () {
			const token = yield* Schema.decodeEffect(ApnsToken)(String.toLowerCase(value))
			const registry = yield* AtomRegistry.AtomRegistry
			const context = yield* AtomRegistry.getResult(registry, RpcClient.runtime)
			yield* registerPushToken(
				pipe(
					RpcClient.use(client => client('push.register', {bundle, kind: 'start', token: Redacted.make(token)})),
					Effect.provideContext(context)
				)
			)
		})
	}

	return {chaptersAtom, readingWritesAtom, registerToken, rpc: RpcClient.runtime, sessionAccount, unsavedAtom}
}
