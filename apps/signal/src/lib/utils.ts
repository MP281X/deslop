import {Array, Effect, Option, Record, Schedule, Stream, Tuple, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {Frame, Hud} from '#services/game/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/signal/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/signal')
}) {}

// What the client knows: the latest frame, every chunk the colony explored by chunk key, the HUD as last sent and the world's seed from the connection's first frame.
export type View = {
	count: number
	explored: Record<string, Frame['explored'][number]>
	frame: Frame
	hud: Option.Option<Hud>
	world: Option.Option<{generator: number; seed: number}>
}

const EMPTY: View = {
	count: 0,
	explored: {},
	frame: {at: 0, changes: [], explored: [], shots: [], units: []},
	hud: Option.none(),
	world: Option.none()
}

// A frame's newly explored chunks over the ones known; most frames bring none.
function merged(known: View['explored'], chunks: Frame['explored']) {
	if (Array.isReadonlyArrayEmpty(chunks)) return known
	return {...known, ...Record.fromEntries(Array.map(chunks, chunk => Tuple.make(`${chunk.cx},${chunk.cz}`, chunk)))}
}

function fold(view: View, frame: Frame) {
	return {
		count: view.count + 1,
		explored: merged(view.explored, frame.explored),
		frame,
		hud: Option.orElse(Option.fromUndefinedOr(frame.hud), () => view.hud),
		world: Option.orElse(Option.fromUndefinedOr(frame.world), () => view.world)
	}
}

// The live view: frames fold into it, and a dropped socket rejoins and gets everything again.
export const viewAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		pipe(
			RpcClient,
			Effect.map(client => client('signal.join', undefined)),
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

// CORE's reply so far, growing as the planner writes it.
export const askAtom = RpcClient.runtime.fn((text: string) =>
	Stream.unwrap(Effect.map(RpcClient, client => client('signal.ask', {text})))
)

// What the pointer is over, published by the world view for the hover card.
type Hover = {id: string; x: number; y: number}
export const hoverAtom = Atom.keepAlive(Atom.make(Option.none<Hover>()))

// What the camera follows: one of the colony's units, and while the overview is on, the frame round it and the units in it.
export type Follow = {id: Option.Option<number>; overview: Option.Option<{x: number; z: number; zoom: number}>}
export const followAtom = Atom.keepAlive(Atom.make<Follow>({id: Option.none(), overview: Option.none()}))
