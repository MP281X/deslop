import {Command, Route} from '@effect/ui'

import {
	Array,
	Context,
	Effect,
	HashMap,
	Layer,
	Option,
	Order,
	Redacted,
	Schema,
	Semaphore,
	Stream,
	String,
	pipe
} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {observe} from '@deslop/runtime/client/atom'
import {keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import {registerPushToken} from '@deslop/runtime/client/push'
import {Shell, observeRead} from '@deslop/runtime/client/shell'
import {ApnsToken} from '@deslop/runtime/shared/apns'
import type {UserId} from '@deslop/runtime/shared/auth'
import {listReducer} from '@deslop/runtime/shared/list'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from '#contracts'

import {ChapterNumberFromString, ReadingPosition, Series, byChapterNumber, keyOf} from '#chapters/contract.ts'
import type {ChapterIdentity, ChapterKey, Position, ReadingChapter} from '#chapters/contract.ts'
import type {ChapterBundle} from '#push/contract.ts'
import {variant} from '#push/shared.ts'

export type OpmRoute = typeof OpmRoute.Type
export const OpmRoute = Route.union({
	Library: Route.make('/', {
		search: {chapter: Schema.optional(ChapterNumberFromString), series: Schema.optional(Series)}
	}),
	NotFound: Route.make('/*')
})

export function libraryOf(route: OpmRoute) {
	if (OpmRoute.isAnyOf(['Library'])(route)) return route
	return OpmRoute.Library({params: {}, search: {}})
}

export function targetOf(route: OpmRoute) {
	if (!OpmRoute.isAnyOf(['Library'])(route) || route.search.chapter === undefined) return undefined
	return {number: route.search.chapter, series: route.search.series ?? 'manga'} satisfies ChapterIdentity
}

const reduceChapters = listReducer<ReadingChapter, ChapterKey>(Order.flip(byChapterNumber), keyOf)

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('Opm/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	const chaptersAtom = Client.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				Stream.unwrap(Effect.map(Client, call => call('chapters.events', undefined))),
				Stream.scan(
					() => Array.empty<ReadingChapter>(),
					(shown, event) => reduceChapters(shown, {...event, removed: []})
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
		Option.match(AsyncResult.value(get(shell.account)), {
			onNone: () => HashMap.empty<ChapterKey, Position>(),
			onSome: account => get(placesByAccountAtoms(account.id))
		})
	)

	const writePermit = Semaphore.makeUnsafe(1)

	const writesAtom = Atom.keepAlive(
		Atom.fn(
			(updates: readonly (typeof ReadingPosition.json.Type)[], get) =>
				Effect.gen(function* () {
					const places = Option.map(AsyncResult.value(get(shell.account)), account => placesByAccountAtoms(account.id))
					function keep(
						update: (current: HashMap.HashMap<ChapterKey, Position>) => HashMap.HashMap<ChapterKey, Position>
					) {
						return Effect.sync(() => Option.map(places, atom => get.set(atom, update(get(atom)))))
					}
					const context = yield* get.result(Client.runtime)
					yield* writePermit.withPermit(
						Effect.forEach(
							updates,
							update =>
								pipe(
									Effect.flatMap(Client, call => call('chapters.write', update)),
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
			const context = yield* AtomRegistry.getResult(yield* AtomRegistry.AtomRegistry, Client.runtime)
			yield* registerPushToken(
				pipe(
					Client,
					Effect.flatMap(call => call('push.register', {bundle, kind: 'start', token: Redacted.make(token)})),
					Effect.provideContext(context)
				)
			)
		})
	}

	return {account: shell.account, chaptersAtom, registerToken, unsavedAtom, writesAtom}
}

class OpmReads extends Context.Service<OpmReads, ReturnType<typeof makeReads>>()('@deslop/opm/reads/OpmReads') {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

// The push-to-start tokens an iPhone reports once Live Activities allow them; the web has none.
export class ChapterTokens extends Context.Service<ChapterTokens, Stream.Stream<string>>()(
	'@deslop/opm/reads/ChapterTokens'
) {}

// Tells the server each token this iPhone reports, for as long as someone is signed in.
export const registerChapters = Stream.unwrap(
	Effect.gen(function* () {
		const reads = yield* OpmReads
		return pipe(
			Stream.changes(yield* ChapterTokens),
			Stream.switchMap(value => Stream.fromEffectDrain(reads.registerToken(value, variant.bundle))),
			Stream.catch(cause =>
				Stream.fromEffectDrain(Effect.logWarning('Live Activities could not be set up on this iPhone', cause))
			)
		)
	})
)

export function readOpm<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(OpmReads.useSync(reads => observeRead(pick(reads), read)))
}

export function observeOpm<A, M>(pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(OpmReads.useSync(reads => observe(pick(reads), read)))
}

// Saves where a page turn left a reader, in order, and keeps the places a dropped connection could not save.
export class Save extends Command.Service<Save>()('Opm/Save', {args: {updates: Schema.Array(ReadingPosition.json)}}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* OpmReads
			const registry = yield* AtomRegistry.AtomRegistry
			return request => Effect.sync(() => registry.set(reads.writesAtom, request.updates))
		})
	)
}

// OPM's own part of what a host mounts on: its reads, and the commands that run on them.
export const layerOpm = Layer.provideMerge(Save.layer, OpmReads.layer)
