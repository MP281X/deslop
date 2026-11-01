import {Array, Boolean, Effect, Number, Option, Record, Schedule, Stream, String, Tuple, pipe} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {readFeed} from '#services/game/lib/page.ts'
import {TEAMS} from '#services/game/lib/utils.ts'
import type {Frame} from '#services/game/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/signal/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/signal')
}) {}

function requestFeed(at: number) {
	return Effect.flatMap(RpcClient, client =>
		readFeed(
			{
				history: (before, tick) =>
					client('signal.history', {
						actor: 'all',
						...Option.match(before, {onNone: () => ({}), onSome: cursor => ({before: cursor})}),
						...Option.match(
							Option.liftPredicate(tick, value => value >= 0),
							{onNone: () => ({}), onSome: value => ({at: value})}
						)
					}),
				thread: (team, before) =>
					client('signal.thread', {
						team,
						...Option.match(before, {onNone: () => ({}), onSome: cursor => ({before: cursor})})
					})
			},
			Array.map(TEAMS, (_team, team) => team),
			at
		)
	)
}

export const feedAtom = Atom.family((at: number) => RpcClient.runtime.atom(requestFeed(at)))
// The authoritative run state is independent of the spectator's live or historical view.
export const runStateAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('signal.status', undefined)),
			Stream.unwrap,
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)

// What the client knows: the latest frame, every chunk explored and prop cleared so far, the buildings, teams and zones as last sent, and the world's seed from the stream's first frame. `count` starts over with each stream, so its first frame tells the world view to start over too.
export type View = {
	buildings: NonNullable<Frame['buildings']>
	// Every tile change so far, by tile.
	changes: Record<string, Frame['changes'][number]>
	cleared: Frame['cleared']
	count: number
	traces: Record<string, NonNullable<Frame['traces']>[number]>
	explored: Record<string, Frame['explored'][number]>
	frame: Frame
	explorationRevision: number
	teams: NonNullable<Frame['teams']>
	world: Option.Option<{generator: number; seed: number}>
	zones: NonNullable<Frame['zones']>
}

export const EMPTY: View = {
	buildings: [],
	changes: {},
	cleared: [],
	count: 0,
	explorationRevision: 0,
	explored: {},
	frame: {at: 0, changes: [], cleared: [], explored: [], shots: [], tick: 0, units: []},
	teams: [],
	traces: {},
	world: Option.none(),
	zones: []
}

function presentedView<E>(current: AsyncResult.AsyncResult<View, E>, previous?: AsyncResult.AsyncResult<View, E>) {
	if (previous === undefined || !Option.exists(AsyncResult.value(previous), view => view.count > 0)) return current
	if (AsyncResult.isInitial(current) || (AsyncResult.isSuccess(current) && current.value.count === 0)) {
		return AsyncResult.waiting(previous)
	}
	if (AsyncResult.isFailure(current)) return AsyncResult.replacePrevious(current, Option.some(previous))
	return current
}

// A frame's newly explored chunks over the ones known; most frames bring none.
function merged(known: View['explored'], chunks: Frame['explored']) {
	if (Array.isReadonlyArrayEmpty(chunks)) return known
	return {...known, ...Record.fromEntries(Array.map(chunks, chunk => Tuple.make(`${chunk.cx},${chunk.cz}`, chunk)))}
}

function changed(known: View['changes'], changes: Frame['changes']) {
	if (Array.isReadonlyArrayEmpty(changes)) return known
	return {...known, ...Record.fromEntries(Array.map(changes, change => Tuple.make(`${change.x},${change.z}`, change)))}
}

function appended(known: View['cleared'], more: Frame['cleared']) {
	if (Array.isReadonlyArrayEmpty(more)) return known
	return [...known, ...more]
}

function trails(known: View['traces'], more: Frame['traces']) {
	if (more === undefined || Array.isReadonlyArrayEmpty(more)) return known
	const updates: View['traces'] = Record.fromEntries(
		Array.map(more, trace => [`${trace.x},${trace.z}`, trace] as const)
	)
	return {
		...Record.filter(known, (_trace, key) => !Record.has(updates, key)),
		...Record.filter(updates, trace => trace.fresh > 0 || trace.smog > 0 || trace.wear > 0)
	}
}

function fold(view: View, frame: Frame) {
	return {
		buildings: frame.buildings ?? view.buildings,
		changes: changed(view.changes, frame.changes),
		cleared: appended(view.cleared, frame.cleared),
		count: view.count + 1,
		explorationRevision: view.explorationRevision + frame.explored.length,
		explored: merged(view.explored, frame.explored),
		frame,
		teams: frame.teams ?? view.teams,
		traces: trails(view.traces, frame.traces),
		world: Option.orElse(Option.fromUndefinedOr(frame.world), () => view.world),
		zones: frame.zones ?? view.zones
	} satisfies View
}

// What the screen shows: the live world, or a replay from a tick at a speed.
export type Source = Option.Option<{from: number; speed: number}>
export const sourceAtom = Atom.keepAlive(Atom.make<Source>(Option.none()))

// The view of the source: frames fold into it, and a dropped socket rejoins and gets everything again.
export const viewAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		pipe(
			RpcClient,
			Effect.map(client =>
				Option.match(get(sourceAtom), {
					onNone: () => client('signal.join', undefined),
					onSome: replay => client('signal.replay', replay)
				})
			),
			Stream.unwrap,
			Stream.scan(() => EMPTY, fold),
			Stream.retry($ =>
				pipe(
					$(Schedule.spaced('1 second')),
					Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
				)
			)
		)
	)
)

export const loadingAtom = Atom.make(get => {
	const result = get(viewAtom)
	return AsyncResult.isInitial(result) || (AsyncResult.isSuccess(result) && result.value.count === 0)
})

// Text and controls refresh twice a second; the renderer still consumes every frame.
export const hudAtom = Atom.keepAlive(
	Atom.make(get => {
		const incoming = get(viewAtom)
		const previous = Option.getOrUndefined(get.self<typeof incoming>())
		const current = presentedView(incoming, previous)
		if (
			previous !== undefined &&
			AsyncResult.isSuccess(previous) &&
			AsyncResult.isSuccess(current) &&
			current.value.count >= previous.value.count &&
			Math.floor(current.value.frame.tick / 10) === Math.floor(previous.value.frame.tick / 10) &&
			current.value.frame.paused === previous.value.frame.paused &&
			current.value.frame.problem === previous.value.frame.problem &&
			current.value.teams === previous.value.teams
		) {
			return previous
		}
		return current
	})
)

export const historyAtom = Atom.family((key: string) => {
	const [actor = 'all', encodedBefore = '0'] = String.split(':')(key)
	const before = Option.getOrElse(Number.parse(encodedBefore), () => 0)
	const request = Effect.flatMap(RpcClient, client =>
		client('signal.history', {
			actor: Boolean.match(actor === 'all', {
				onFalse: () => Option.getOrElse(Number.parse(actor), () => 0),
				onTrue: () => 'all' as const
			}),
			...Option.match(
				Option.filter(Option.some(before), value => value > 0),
				{onNone: () => ({}), onSome: cursor => ({before: cursor})}
			)
		})
	)
	if (before > 0) return RpcClient.runtime.atom(request)
	return Atom.setIdleTTL(
		RpcClient.runtime.atom(
			pipe(
				Stream.tick('5 seconds'),
				Stream.mapEffect(() => request)
			)
		),
		0
	)
})

// The world's seed, kept while the view's stream starts over, as a replay begins or ends.
export const seedAtom = Atom.keepAlive(
	Atom.make(get =>
		Option.orElse(
			Option.map(
				Option.flatMap(AsyncResult.value(get(viewAtom)), view => view.world),
				world => world.seed
			),
			() => Option.flatten(get.self<Option.Option<number>>())
		)
	)
)

export const cursorAtom = Atom.make(get => {
	const view = Option.getOrElse(AsyncResult.value(get(hudAtom)), () => EMPTY)
	const loading = get(loadingAtom)
	return Option.match(get(sourceAtom), {
		onNone: () => {
			if (!loading) return view.frame.tick
			return view.frame.live ?? view.frame.tick
		},
		onSome: replay => {
			if (loading) return replay.from
			return Number.max(replay.from, view.frame.tick)
		}
	})
})

// Event navigation freezes the spectator, not the live log or its paging cursors.
export const threadFeedAtom = Atom.setIdleTTL(
	RpcClient.runtime.atom(
		pipe(
			Stream.tick('5 seconds'),
			Stream.mapEffect(() => requestFeed(-1))
		)
	),
	0
)

// What the pointer is over, published by the world view for the hover card.
type Hover = {id: string; x: number; y: number}
export const hoverAtom = Atom.keepAlive(Atom.make(Option.none<Hover>()))

// What the camera follows: a unit or a place.
export type Follow = {free: Option.Option<{x: number; z: number}>; id: Option.Option<number>}
export const followAtom = Atom.keepAlive(Atom.make<Follow>({free: Option.none(), id: Option.none()}))

// The team whose thread and units the sidebar shows.
export const teamAtom = Atom.keepAlive(Atom.make(0))
