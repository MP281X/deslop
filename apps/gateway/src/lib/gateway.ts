import {Effect, Option, Schema, Stream} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom, AtomRpc} from 'effect/reactivity'

import {keepValueThroughOutages, liveAtom, reconnectOnDrop} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {ServerUrl} from '#services/connections/schema.ts'
import type {ServerId} from '#services/connections/schema.ts'
import type {Period} from '#services/usage/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly aiKey: never
	}
}

addPageTelemetry('@deslop/gateway')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/lib/gateway/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

function connectUrl(id: ServerId) {
	return `/oauth/connect?${new URLSearchParams({id})}`
}

// Leaves for the server's authorization; it stays pending until the page unloads, so the button cannot start a second one.
export const connectAtom = Atom.family((id: ServerId) =>
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
				yield* Effect.mapError(Schema.decodeEffect(ServerUrl)(url), cause =>
					AuthError.make({
						cause,
						message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
					})
				)
				const server = yield* Effect.flatMap(RpcClient, client => client('connections.add', {url}))
				if (server.status !== 'Connected') location.assign(connectUrl(server.id))
			})
		},
		events: Machine.events({Submit: {}, Typed: {url: Schema.String}}),
		root: Machine.state({
			states: {
				Adding: {fields: {url: Schema.String}},
				Editing: {fields: {error: Schema.OptionFromOptionalKey(Schema.String), url: Schema.String}}
			}
		})
	}).handle({
		initial: {data: {error: Option.none(), url: ''}, target: 'Editing'},
		on: {Typed: {data: transition => ({error: Option.none(), url: transition.event.url}), target: 'Editing'}},
		states: {
			Adding: {
				invoke: {
					input: transition => transition.state.url,
					onDone: {data: {error: Option.none(), url: ''}, target: 'Editing'},
					onFailure: {
						data: transition => ({error: Option.some(transition.error.message), url: transition.state.url}),
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
export const aiKeyAtom = RpcClient.runtime.factory.withReactivity(['aiKey'])(
	RpcClient.runtime.atom(get =>
		keepValueThroughOutages(
			get,
			Stream.fromEffect(Effect.flatMap(RpcClient, client => client('ai-proxy.key', undefined))),
			reconnectOnDrop
		)
	)
)

// A period's report now and after each recorded call; the server reopens the window at each bucket boundary.
export const aiUsageAtom = Atom.family((period: Period) =>
	Atom.keepAlive(liveAtom(RpcClient, 'ai-metering.usage', period))
)

export const mcpUsageAtom = Atom.family((period: Period) =>
	Atom.keepAlive(liveAtom(RpcClient, 'connections.usage', period))
)

export const setKeyAtom = RpcClient.mutation('ai-proxy.setKey')
