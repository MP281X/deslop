import {Array, Effect, HashMap, Option, Order, Semaphore, Stream, pipe} from 'effect'

import {AsyncResult, Atom} from 'effect/reactivity'

import {writeOutcome} from '@deslop/runtime/client/protocol'
import type {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'
import {sessionAccount} from '@deslop/ui/native'
import {liveList} from '@deslop/ui/state'

import {byChapterNumber, keyOf} from '#contracts'
import type {ChapterKey, Position, ReadingChapter, ReadingPosition} from '#contracts'

import {RpcClient} from '#web/session.ts'

const reduceChapters = listReducer<ReadingChapter, ChapterKey>(Order.flip(byChapterNumber), keyOf)

export const chaptersAtom = RpcClient.runtime.atom(get =>
	liveList(
		get,
		Stream.unwrap(Effect.map(RpcClient, client => client('chapters.events', undefined))),
		Array.empty<ReadingChapter>,
		(chapters, event) => reduceChapters(chapters, {...event, removed: []})
	)
)

// A place a disconnected write could not save belongs to the account that turned the page.
const placesByAccountAtoms = Atom.family((_account: UserId) =>
	Atom.keepAlive(Atom.make(HashMap.empty<ChapterKey, Position>()))
)

export const unsavedAtom = Atom.make(get =>
	Option.match(AsyncResult.value(get(sessionAccount)), {
		onNone: () => HashMap.empty<ChapterKey, Position>(),
		onSome: account => get(placesByAccountAtoms(account.id))
	})
)

const writePermit = Semaphore.makeUnsafe(1)

export const readingWritesAtom = Atom.keepAlive(
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
