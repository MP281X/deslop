import {Command, Route} from '@effect/ui'

import {
	Array,
	Cause,
	Context,
	DateTime,
	Effect,
	Function,
	Layer,
	Option,
	Order,
	Predicate,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {SecureRandom} from 'effect/crypto'
import type {AsyncResult} from 'effect/reactivity'
import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {backOrHome} from '@deslop/components/navigation'
import {keepValueThroughOutages, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {writeOutcome} from '@deslop/runtime/client/protocol'
import {Shell, observeRead} from '@deslop/runtime/client/shell'
import {listReducer} from '@deslop/runtime/shared/list'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {NoteId, NotesRpcs} from '#notes/contract.ts'
import type {NoteItem, NotesError} from '#notes/contract.ts'

export type StashRoute = typeof StashRoute.Type
export const StashRoute = Route.union({
	Home: Route.make('/', {
		search: {note: Schema.optional(NoteId), pane: Schema.optional(Schema.Literals(['detail', 'list']))}
	}),
	NotFound: Route.make('/*')
})

export function noteOf(route: StashRoute) {
	return StashRoute.match(route, {Home: found => found.search.note, NotFound: Function.constUndefined})
}

export function showsDetail(route: StashRoute) {
	return (
		StashRoute.isAnyOf(['Home'])(route) &&
		(route.search.pane === 'detail' || (route.search.pane === undefined && route.search.note !== undefined))
	)
}

const newestFirst = pipe(
	Order.mapInput(DateTime.Order, (item: NoteItem) => item.createdAt),
	Order.combine(Order.mapInput(Order.String, (item: NoteItem) => item.id)),
	Order.flip
)
const apply = listReducer(newestFirst, (note: NoteItem) => note.id)

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('Stash/Rpc', {
		group: NotesRpcs.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	const notesAtom = Client.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			pipe(
				Stream.unwrap(Effect.map(Client, call => call('notes.events', undefined))),
				Stream.scan(Array.empty<NoteItem>, apply),
				Stream.drop(1)
			),
			reconnectOnDrop
		)
	)

	// The stream replaces an item when it changes; the new item reads its body again.
	const bodyAtoms = Atom.family((item: NoteItem) =>
		Client.runtime.atom(Effect.flatMap(Client, call => call('notes.body', {id: item.id})))
	)
	const mediaAtoms = Atom.family((item: NoteItem) =>
		Client.runtime.atom(Effect.flatMap(Client, call => call('notes.media', {id: item.id})))
	)

	function write<A, E>(registry: AtomRegistry.AtomRegistry, effect: Effect.Effect<A, E, Client>) {
		return pipe(
			registry,
			AtomRegistry.getResult(Client.runtime),
			Effect.flatMap(context => writeOutcome(Effect.provideContext(effect, context)))
		)
	}

	return {
		account: shell.account,
		bodyAtoms,
		capture: (registry: AtomRegistry.AtomRegistry, text: string) =>
			write(
				registry,
				Effect.flatMap(Client, call => call('notes.capture', {id: NoteId.make(SecureRandom.uuidV4Unsafe()), text}))
			),
		mediaAtoms,
		notesAtom,
		regenerate: (registry: AtomRegistry.AtomRegistry, id: NoteId) =>
			write(
				registry,
				Effect.flatMap(Client, call => call('notes.regenerate', {id}))
			)
	}
}

class StashReads extends Context.Service<StashReads, ReturnType<typeof makeReads>>()('@deslop/stash/reads/StashReads') {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

// What each host does on its own: share and open, read the clipboard, keep the draft, hand queued shares over and tell when the app comes back.
export class Device extends Context.Service<
	Device,
	{
		readonly activation: Stream.Stream<void>
		readonly narrow: () => boolean
		readonly openLink: (url: string) => Effect.Effect<void, NotesError>
		readonly paste: Effect.Effect<Option.Option<string>, NotesError>
		readonly readDraft: () => string
		readonly settleShares: Effect.Effect<readonly string[], NotesError>
		readonly share: (text: string) => Effect.Effect<void, NotesError>
		readonly writeDraft: (text: string) => void
	}
>()('@deslop/stash/reads/Device') {}

export function readStash<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(StashReads.useSync(reads => observeRead(pick(reads), read)))
}

// Each time the app comes to the front, and once as it starts.
export const activated = Stream.unwrap(Effect.map(Device, device => device.activation))

export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({
	Capture: {text: Schema.String},
	OpenLink: {url: Schema.String},
	Paste: {},
	Regenerate: {id: NoteId},
	Share: {text: Schema.String}
})

// What the commands that act on the notes work with.
const services = Effect.all({device: Device, reads: StashReads, registry: AtomRegistry.AtomRegistry}, {concurrency: 1})

function problemText(cause: Cause.Cause<unknown>) {
	const error = Cause.squash(cause)
	if (Predicate.hasProperty(error, 'message') && Predicate.isString(error.message)) return error.message
	return 'Stash could not complete this action.'
}

// Runs what the person asked of a note, and answers with what went wrong, if anything.
export class Run extends Command.Service<Run>()('Stash/Run', {
	args: {action: Action},
	success: Schema.UndefinedOr(Schema.String)
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			use => request =>
				Effect.matchCause(
					Action.match(request.action, {
						Capture: input => Effect.asVoid(use.reads.capture(use.registry, String.trim(input.text))),
						OpenLink: input => use.device.openLink(input.url),
						Paste: () =>
							Effect.flatMap(
								use.device.paste,
								Option.match({
									onNone: () => Effect.void,
									onSome: text => Effect.asVoid(use.reads.capture(use.registry, text))
								})
							),
						Regenerate: input => use.reads.regenerate(use.registry, input.id),
						Share: input => use.device.share(input.text)
					}),
					{onFailure: problemText, onSuccess: Function.constUndefined}
				)
		)
	)
}

// Hands over the shares the extension queued, once the account answers, and says what the server refused.
export class Wake extends Command.Service<Wake>()('Stash/Wake', {
	args: {refresh: Schema.Boolean},
	success: Schema.UndefinedOr(Schema.String)
}) {
	static readonly layer = this.toLayer(
		Effect.map(
			services,
			use => request =>
				Effect.gen(function* () {
					if (request.refresh) use.registry.refresh(use.reads.account)
					const account = yield* Effect.option(
						AtomRegistry.getResult(use.registry, use.reads.account, {suspendOnWaiting: true})
					)
					if (Option.isNone(account)) return undefined
					return yield* Effect.match(use.device.settleShares, {
						onFailure: error => error.message,
						onSuccess: rejections =>
							pipe(
								Option.liftPredicate(rejections, Array.isReadonlyArrayNonEmpty),
								Option.map(Array.join('\n')),
								Option.getOrUndefined
							)
					})
				})
		)
	)
}

export class ReadDraft extends Command.Service<ReadDraft>()('Stash/ReadDraft', {args: {}, success: Schema.String}) {
	static readonly layer = this.toLayer(Effect.map(Device, device => () => Effect.sync(device.readDraft)))
}

export class StoreDraft extends Command.Service<StoreDraft>()('Stash/StoreDraft', {args: {text: Schema.String}}) {
	static readonly layer = this.toLayer(
		Effect.map(Device, device => request => Effect.sync(() => device.writeDraft(request.text)))
	)
}

// Back to the queue: one step in the history, or the queue itself when the note was the way in; `narrowOnly` leaves a wide screen, which shows both, where it is.
export class BackToQueue extends Command.Service<BackToQueue>()('Stash/BackToQueue', {
	args: {narrowOnly: Schema.Boolean}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const device = yield* Device
			const back = yield* backOrHome(StashRoute.Home({search: {}}))
			return request => {
				if (request.narrowOnly && !device.narrow()) return Effect.void
				return back()
			}
		})
	)
}

// Stash's own part of what a host mounts on: its reads, and the commands that run on them and on the device.
export const layerStash = Layer.provideMerge(
	Layer.mergeAll(Run.layer, Wake.layer, ReadDraft.layer, StoreDraft.layer, BackToQueue.layer),
	StashReads.layer
)
