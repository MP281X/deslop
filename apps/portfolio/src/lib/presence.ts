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

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/portfolio/lib/presence/RpcClient', {
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

// The guest's colour; the joined scene overwrites the tab's random pick, so tabs of the same guest share it.
export const ownColorAtom = Atom.make(Color.literals[randomIndex(Array.length(Color.literals))] ?? Color.literals[0])

// Changes only with this tab's pointer: a tab joining for a guest already present must not move the shared cursor.
export const ownCursorAtom = Atom.make({x: 0.5, y: 0.5})

// The room as this tab last read it, with the trails its cursors left since it joined; a rejoin starts with no trails, and an outage past the quiet reconnect fails it until a scene arrives again.
export const sceneAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		Stream.unwrap(
			Effect.map(get.result(identityAtom), identity =>
				keepValueThroughOutages(
					get,
					Stream.suspend(() =>
						pipe(
							liveStream(RpcClient, 'presence.join', {...identity, color: get.once(ownColorAtom)}),
							Stream.tap(scene =>
								Effect.sync(() => {
									pipe(
										scene.visitors,
										Array.findFirst(visitor => visitor.id === scene.own && visitor.color !== get.once(ownColorAtom)),
										Option.map(visitor => get.set(ownColorAtom, visitor.color))
									)
								})
							),
							Stream.mapAccum(
								() => ({bots: [], trails: [], visitors: []}),
								(previous: {bots: Visitors; trails: Visitors; visitors: Visitors}, update: Scene) => {
									const next = {...update, trails: appendTrails(previous.trails, previous, update)}
									return Tuple.make(next, [next])
								}
							)
						)
					),
					// A dropped socket can rejoin, but retrying an unreadable scene will not repair it.
					reconnectOnDrop
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
	const current = get(ownColorAtom)
	const choices = Array.filter(Color.literals, color => color !== current)
	return pipe(
		RpcClient,
		Effect.flatMap(client =>
			client('presence.recolor', {color: choices[randomIndex(Array.length(choices))] ?? Color.literals[0]})
		),
		Effect.ignore({log: 'Debug', message: 'The cursor recolor did not reach the room'})
	)
})
