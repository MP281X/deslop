import {Array, Effect, HashMap, Option, Order, Semaphore, Stream, pipe} from 'effect'

import type {AtomRegistry} from 'effect/reactivity'
import {AsyncResult, Atom} from 'effect/reactivity'

import {keepValueThroughOutages, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import type {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'

import {RpcClient, accountAtom} from '#lib/session.ts'
import {byNumber, keyOf} from '#services/chapters/lib/utils.ts'
import type {ChapterItem, ChapterKey, Position, ReadingPosition} from '#services/chapters/schema.ts'

const reduceChapters = listReducer<ChapterItem, ChapterKey>(Order.flip(byNumber), keyOf)

export const chaptersAtom = RpcClient.runtime.atom(get =>
	keepValueThroughOutages(
		get,
		pipe(
			liveStream(RpcClient, 'chapters.events'),
			Stream.scan(Array.empty<ChapterItem>, (chapters, event) => reduceChapters(chapters, {...event, removed: []})),
			Stream.drop(1)
		),
		reconnectOnDrop
	)
)

// A place a disconnected write could not save belongs to the account that turned the page.
const placesByAccountAtoms = Atom.family((_account: UserId) =>
	Atom.keepAlive(Atom.make(HashMap.empty<ChapterKey, Position>()))
)

export const unsavedAtom = Atom.make(get =>
	Option.match(AsyncResult.value(get(accountAtom)), {
		onNone: () => HashMap.empty<ChapterKey, Position>(),
		onSome: account => get(placesByAccountAtoms(account.id))
	})
)

const readingWrites = Semaphore.makeUnsafe(1)

const readAtom = Atom.keepAlive(
	Atom.fn(
		(updates: readonly (typeof ReadingPosition.json.Type)[], get) =>
			Effect.gen(function* () {
				const places = Option.map(AsyncResult.value(get(accountAtom)), account => placesByAccountAtoms(account.id))
				function keep(
					update: (current: HashMap.HashMap<ChapterKey, Position>) => HashMap.HashMap<ChapterKey, Position>
				) {
					return Effect.sync(() => Option.map(places, atom => get.set(atom, update(get(atom)))))
				}
				const context = yield* get.result(RpcClient.runtime)
				yield* readingWrites.withPermit(
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

export function writePositions(
	registry: AtomRegistry.AtomRegistry,
	updates: readonly (typeof ReadingPosition.json.Type)[]
) {
	return Effect.sync(() => registry.set(readAtom, updates))
}
