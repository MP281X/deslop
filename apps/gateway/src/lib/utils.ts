import {Effect, Schema, Stream, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, liveAtom, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {ServerUrl, UpstreamError} from '#services/connections/schema.ts'
import type {Period} from '#services/usage/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly aiKeys: never
	}
}

// The keys reader's reactivity key: saving a key rereads them.
export const AI_KEYS = ['aiKeys'] as const

export const ENDPOINT = `${window.location.origin}/mcp`

addPageTelemetry('@deslop/gateway')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/lib/utils/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

function connectUrl(id: string) {
	return `/oauth/connect?${new URLSearchParams({id})}`
}

// Leaves for the server's authorization; it stays pending until the page unloads, so the button cannot start a second one.
export const connectAtom = Atom.family((id: string) =>
	Atom.fn(() =>
		Effect.andThen(
			Effect.sync(() => location.assign(connectUrl(id))),
			Effect.never
		)
	)
)

export const serversAtom = Atom.keepAlive(liveAtom(RpcClient, 'connections.watch'))

// The field under the bar: its text and why the last add failed, until the next edit; a success clears it.
export const addAtom = AtomMachine.bind(RpcClient.runtime).make(
	Machine.make({
		effects: {
			add: Effect.fnUntraced(function* (url: string) {
				yield* pipe(
					Schema.decodeEffect(ServerUrl)(url),
					Effect.mapError(cause =>
						AuthError.make({
							cause,
							message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
						})
					)
				)
				const server = yield* Effect.flatMap(RpcClient, client => client('connections.add', {url}))
				if (server.status !== 'Connected') location.assign(connectUrl(server.id))
			})
		},
		events: Machine.events({Submit: {}, Typed: {url: Schema.String}}),
		root: Machine.state({
			states: {Adding: {fields: {url: Schema.String}}, Editing: {fields: {error: Schema.String, url: Schema.String}}}
		})
	}).handle({
		initial: {data: {error: '', url: ''}, target: 'Editing'},
		on: {Typed: {data: transition => ({error: '', url: transition.event.url}), target: 'Editing'}},
		states: {
			Adding: {
				invoke: {
					input: transition => transition.state.url,
					onDone: {data: {error: '', url: ''}, target: 'Editing'},
					onFailure: {
						data: transition => ({error: transition.error.message, url: transition.state.url}),
						target: 'Editing'
					},
					src: 'add'
				}
			},
			Editing: {on: {Submit: {data: transition => ({url: transition.state.url}), target: 'Adding'}}}
		}
	})
)

// Read like the live streams, so a refusal clears the keys too; saving a key rereads them.
export const aiKeysAtom = pipe(
	RpcClient.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			Stream.fromEffect(Effect.flatMap(RpcClient, client => client('ai.keys', undefined))),
			reconnectOnDrop
		)
	),
	RpcClient.runtime.factory.withReactivity(AI_KEYS)
)

// A period's report now and after each recorded call; the server reopens the window at each bucket boundary.
export const aiUsageAtom = Atom.family((period: Period) => Atom.keepAlive(liveAtom(RpcClient, 'ai.usage', period)))

export const mcpUsageAtom = Atom.family((period: Period) =>
	Atom.keepAlive(liveAtom(RpcClient, 'connections.usage', period))
)

export const setKeyAtom = RpcClient.mutation('ai.setKey')

// The copy button's check, set by the copy and cleared a moment later.
export const copiedAtom = Atom.make(false)

// The button confirms a copy in place; a failure leaves it destructive until the next press.
export const copyAtom = Atom.family((value: string) =>
	Atom.fn(() =>
		pipe(
			// A press inside the check's moment starts over, so a copy that now fails does not keep the check.
			Atom.set(copiedAtom, false),
			Effect.andThen(
				Effect.tryPromise({
					catch: cause => UpstreamError.make({cause}),
					try: () => navigator.clipboard.writeText(value)
				})
			),
			Effect.andThen(Atom.set(copiedAtom, true)),
			Effect.andThen(Effect.sleep('1500 millis')),
			Effect.andThen(Atom.set(copiedAtom, false))
		)
	)
)
