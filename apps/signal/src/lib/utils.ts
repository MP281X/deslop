import {Array, Effect, Number, Option, Record, Schedule, Stream, String, Tuple, pipe} from 'effect'

import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {Frame} from '#services/game/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/signal/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/signal')
}) {}

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

// Text and controls refresh twice a second; the renderer still consumes every frame.
export const hudAtom = Atom.keepAlive(
	Atom.make(get => {
		const current = get(viewAtom)
		const previous = Option.getOrUndefined(get.self<typeof current>())
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
	const [actor = 0, before = 0, at = -1] = Array.map(String.split(':')(key), part =>
		Option.getOrElse(Number.parse(part), () => 0)
	)
	return RpcClient.runtime.atom(
		pipe(
			Stream.tick('5 seconds'),
			Stream.mapEffect(() =>
				Effect.flatMap(RpcClient, client =>
					client('signal.history', {
						actor,
						...Option.match(
							Option.filter(Option.some(at), value => value >= 0),
							{onNone: () => ({}), onSome: tick => ({at: tick})}
						),
						...Option.match(
							Option.filter(Option.some(before), value => value > 0),
							{onNone: () => ({}), onSome: cursor => ({before: cursor})}
						)
					})
				)
			)
		)
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

// The run's marks and span, kept fresh.
export const timelineAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			Stream.tick('10 seconds'),
			Stream.mapEffect(() => Effect.flatMap(RpcClient, client => client('signal.timeline', undefined)))
		)
	)
)

// A team's latest rounds, kept fresh.
export const liveThreadAtom = Atom.family((team: number) =>
	RpcClient.runtime.atom(
		pipe(
			Stream.tick('5 seconds'),
			Stream.mapEffect(() => Effect.flatMap(RpcClient, client => client('signal.thread', {team})))
		)
	)
)

// A team's rounds before a replay's, by `team:round`.
export const pastThreadAtom = Atom.family((key: string) => {
	const [team = 0, before = 0] = Array.map(String.split(':')(key), part =>
		Option.getOrElse(Number.parse(part), () => 0)
	)
	return RpcClient.runtime.atom(Effect.flatMap(RpcClient, client => client('signal.thread', {before, team})))
})

// What the pointer is over, published by the world view for the hover card.
type Hover = {id: string; x: number; y: number}
export const hoverAtom = Atom.keepAlive(Atom.make(Option.none<Hover>()))

// What the camera follows: a unit, or a place the player left it at; the overview zooms out over the team with the fog off.
export type Follow = {free: Option.Option<{x: number; z: number}>; id: Option.Option<number>; overview: boolean}
export const followAtom = Atom.keepAlive(Atom.make<Follow>({free: Option.none(), id: Option.none(), overview: false}))

// The team whose thread and units the sidebar shows.
export const teamAtom = Atom.keepAlive(Atom.make(0))
