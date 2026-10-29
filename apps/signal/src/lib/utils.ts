import {Effect, Option, Schedule, Stream, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {Frame, Hud} from '#services/game/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/signal/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/signal')
}) {}

// What the client knows: the latest frame, the HUD as last sent and the world's seed from the connection's first frame.
export type View = {
	count: number
	frame: Frame
	hud: Option.Option<Hud>
	world: Option.Option<{generator: number; seed: number}>
}

const EMPTY: View = {
	count: 0,
	frame: {at: 0, changes: [], shots: [], units: []},
	hud: Option.none(),
	world: Option.none()
}

function fold(view: View, frame: Frame) {
	return {
		count: view.count + 1,
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
