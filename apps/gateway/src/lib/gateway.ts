import {Effect, Function, Option, Schema, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {TimeFrame} from '@deslop/runtime/shared/time'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {AiSetKey} from '#services/ai-proxy/schema.ts'
import {ServerUrl} from '#services/connections/schema.ts'
import type {ServerId} from '#services/connections/schema.ts'

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
export const addEvents = Machine.events({Invalid: {message: Schema.String}, Submit: {}, Typed: {url: Schema.String}})
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
		events: addEvents,
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
			Editing: {
				on: {
					Invalid: {
						data: transition => ({error: Option.some(transition.event.message), url: transition.state.url}),
						target: 'Editing'
					},
					Submit: {data: transition => ({url: transition.state.url}), target: 'Adding'}
				}
			}
		}
	})
)

export const aiKeyAtom = Atom.keepAlive(liveAtom(RpcClient, 'ai-proxy.key'))

// A period's report now and after each recorded call; the server reopens the window at each bucket boundary.
export const aiUsageAtom = Atom.family((period: TimeFrame) => liveAtom(RpcClient, 'ai-metering.usage', period))

export const mcpUsageAtom = Atom.family((period: TimeFrame) => liveAtom(RpcClient, 'connections.usage', period))

// A key pasted under the bar, held only while its dialog is open: saving or dismissing it drops the plaintext.
export const pastedKeyAtom = Atom.make(Option.none<string>())

export const setKeyAtom = RpcClient.runtime.fn((input: AiSetKey, get) =>
	pipe(
		RpcClient,
		Effect.flatMap(client => client('ai-proxy.setKey', input)),
		Effect.tap(() => Effect.sync(() => get.set(pastedKeyAtom, Option.none())))
	)
)

// Opens the key dialog on a pasted key, clear of the last attempt's failure.
export const openKeyAtom = Atom.writable(Function.constUndefined, (context, secret: string) => {
	context.set(setKeyAtom, Atom.Reset)
	context.set(pastedKeyAtom, Option.some(secret))
})
