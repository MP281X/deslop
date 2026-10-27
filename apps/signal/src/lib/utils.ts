import {Array, Effect, Function, HashMap, HashSet, Option, Schedule, Stream, String, pipe} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'

import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {chunkKey, chunkOf} from '#services/game/lib/utils.ts'
import type {EntityInfo, Frame, Hud, Point} from '#services/game/schema.ts'

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/signal/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/signal')
}) {}

// What the client knows, folded from the server's delta frames.
export type View = {
	// Server time of the latest frame, which event ages count from.
	at: number
	depleted: HashSet.HashSet<string>
	// Bumped per chunk when one of its ore tiles runs out, so only that chunk's mesh rebuilds.
	depletedChunks: HashMap.HashMap<string, number>
	explored: HashMap.HashMap<string, Uint8Array>
	frame: number
	hud: Option.Option<Hud>
	info: HashMap.HashMap<number, EntityInfo>
	positions: Float32Array
	shots: Frame['shots']
}

export type Focus = {controlled: boolean; drone?: number; overview: boolean}

function applyFrame(view: View, frame: Frame) {
	// A tile can arrive twice, live and again with its chunk; only new ones change a chunk's count.
	const fresh = Array.dedupeWith(
		Array.filter(frame.depleted, point => !HashSet.has(view.depleted, chunkKey(point.x, point.z))),
		(first: Point, second: Point) => first.x === second.x && first.z === second.z
	)
	return {
		at: frame.at,
		depleted: Array.reduce(fresh, view.depleted, (set, point) => HashSet.add(set, chunkKey(point.x, point.z))),
		depletedChunks: Array.reduce(fresh, view.depletedChunks, (map, point) =>
			HashMap.modifyAt(map, chunkKey(chunkOf(point.x), chunkOf(point.z)), count =>
				Option.some(Option.getOrElse(count, () => 0) + 1)
			)
		),
		explored: Array.reduce(frame.explored, view.explored, (map, chunk) =>
			HashMap.set(map, chunkKey(chunk.cx, chunk.cz), chunk.bits)
		),
		frame: view.frame + 1,
		hud: Option.orElse(Option.fromUndefinedOr(frame.hud), () => view.hud),
		info: Array.reduce(
			frame.gone,
			Array.reduce(frame.entities, view.info, (map, entity) => HashMap.set(map, entity.id, entity)),
			(map, id) => HashMap.remove(map, id)
		),
		// Copy into an aligned buffer: the decoded bytes can start at any offset.
		positions: new Float32Array(Uint8Array.from(frame.positions).buffer),
		shots: frame.shots
	} satisfies View
}

// One live view per invite code: frames fold into it, and a dropped socket rejoins.
export const viewAtom = Atom.family((invite: string) =>
	Atom.keepAlive(
		RpcClient.runtime.atom(
			pipe(
				RpcClient,
				Effect.map(client =>
					client(
						'signal.join',
						Option.match(Option.liftPredicate(invite, String.isNonEmpty), {
							onNone: () => ({}),
							onSome: code => ({invite: code})
						})
					)
				),
				Stream.unwrap,
				// The fold restarts with each connection: a new server connection resends everything, not what vanished meanwhile.
				Stream.scan(
					Function.constant<View>({
						at: 0,
						depleted: HashSet.empty(),
						depletedChunks: HashMap.empty(),
						explored: HashMap.empty(),
						frame: 0,
						hud: Option.none(),
						info: HashMap.empty(),
						positions: new Float32Array(0),
						shots: []
					}),
					applyFrame
				),
				Stream.retry($ =>
					pipe(
						$(Schedule.spaced('1 second')),
						Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
					)
				)
			)
		)
	)
)

export const steerAtom = RpcClient.mutation('signal.steer')
export const actAtom = RpcClient.mutation('signal.act')
// The renderer publishes which drone the signal is on; the HUD asks it to jump to another.
export const focusAtom = Atom.keepAlive(Atom.make<Focus>({controlled: false, overview: false}))
export const jumpAtom = Atom.keepAlive(Atom.make({at: 0, drone: 0}))

// Holds CORE's reply so far, waiting until the stream ends; an order for the drone you fly hands it back, as jumping to it does.
export const askAtom = RpcClient.runtime.fn((payload: {drone?: number; text: string}, get) =>
	pipe(
		Stream.unwrap(Effect.map(RpcClient, client => client('signal.ask', payload))),
		Stream.tap(reply =>
			Effect.sync(() => {
				const focus = get(focusAtom)
				if (reply.done && focus.controlled && focus.drone !== undefined && Array.contains(reply.drones, focus.drone)) {
					get.set(jumpAtom, {at: get(jumpAtom).at + 1, drone: focus.drone})
				}
			})
		)
	)
)
