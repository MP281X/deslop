import {Array, Effect, Option, Random, Schema, Stream, String, Tuple, pipe} from 'effect'

import {SecureRandom} from 'effect/crypto'
import {KeyValueStore} from 'effect/persistence'
import {Atom, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, liveStream, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {appendTrails} from '#lib/trails.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {hasMeaningfulMove} from '#services/presence/lib/utils.ts'
import {Color, GuestKey} from '#services/presence/schema.ts'
import type {Scene, Visitors} from '#services/presence/schema.ts'

addPageTelemetry('@deslop/portfolio')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/lib/presence/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

function randomIndex(length: number) {
	return Math.floor(Random.Random.defaultValue().nextDoubleUnsafe() * length)
}

// The tab's guest key and label, kept through reloads; the key is a secret its tabs share, never shown or broadcast.
const identityAtom = Atom.keepAlive(
	Atom.kvs({
		defaultValue: () => ({
			key: GuestKey.make(SecureRandom.uuidV4Unsafe()),
			name: `Guest-${String.slice(0, 3)(SecureRandom.uuidV4Unsafe())}`
		}),
		key: 'portfolio.guest',
		mode: 'async',
		runtime: Atom.runtime(KeyValueStore.layerStorage(() => sessionStorage)),
		schema: Schema.Struct({key: GuestKey, name: Schema.NonEmptyString})
	})
)

// Pointer movement is local; the joined scene overwrites the colour, so tabs of the same guest share it.
export const ownCursorAtom = Atom.make({
	color: Color.literals[randomIndex(Array.length(Color.literals))] ?? Color.literals[0],
	x: 0.5,
	y: 0.5
})

// The room as this tab last read it, with the trails its cursors left; an outage past the quiet reconnect fails it until a scene arrives again.
export const sceneAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		Stream.unwrap(
			Effect.map(get.result(identityAtom), identity =>
				Stream.mapAccum(
					keepValueThroughOutages(
						get,
						Stream.tap(
							Stream.suspend(() =>
								liveStream(RpcClient, 'presence.join', {...identity, color: get.once(ownCursorAtom).color})
							),
							scene =>
								Effect.sync(() => {
									const cursor = get.once(ownCursorAtom)
									pipe(
										scene.visitors,
										Array.findFirst(visitor => visitor.id === scene.own && visitor.color !== cursor.color),
										Option.map(visitor => get.set(ownCursorAtom, {...cursor, color: visitor.color}))
									)
								})
						),
						// A dropped socket can rejoin with its trails, but retrying an unreadable scene will not repair it.
						reconnectOnDrop
					),
					() => ({bots: [], trails: [], visitors: []}),
					(previous: {bots: Visitors; trails: Visitors; visitors: Visitors}, update: Scene) => {
						const next = {...update, trails: appendTrails(previous.trails, previous, update)}
						return Tuple.make(next, [next])
					}
				)
			)
		)
	)
)

// Sends this page's position while the page is open: at most one move per 50 ms, always the latest, and none too small to see.
export const sendCursorAtom = RpcClient.runtime.atom(get =>
	pipe(
		get.stream(ownCursorAtom, {withoutInitialValue: true}),
		Stream.changesWith((sent, next) => !hasMeaningfulMove(sent, next)),
		Stream.buffer({capacity: 1, strategy: 'sliding'}),
		Stream.throttle({cost: Array.length, duration: '50 millis', units: 1}),
		Stream.runForEach(cursor =>
			pipe(
				RpcClient,
				Effect.flatMap(client => client('presence.move', {x: cursor.x, y: cursor.y})),
				Effect.ignore({log: 'Debug', message: 'The cursor move did not reach the room'})
			)
		)
	)
)

export const recolorAtom = RpcClient.runtime.fn((_: void, get) => {
	const current = get(ownCursorAtom).color
	const choices = Array.filter(Color.literals, color => color !== current)
	return pipe(
		RpcClient,
		Effect.flatMap(client =>
			client('presence.recolor', {color: choices[randomIndex(Array.length(choices))] ?? Color.literals[0]})
		),
		Effect.ignore({log: 'Debug', message: 'The cursor recolor did not reach the room'})
	)
})
