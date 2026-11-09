import {Effect, Redacted, Schema, Stream, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {Atom, AtomRpc, Reactivity} from 'effect/reactivity'

import {toast} from '@deslop/components-web/ui/toast'
import {AuthError} from '@deslop/runtime/auth/schema'
import {withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {AiProvider} from '#services/ai/schema.ts'
import {ServerUrl, UpstreamError} from '#services/connections/schema.ts'
import type {Period} from '#services/usage/schema.ts'

export const ENDPOINT = `${window.location.origin}/mcp`

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer()
}) {}

export function connectUrl(id: string) {
	return `/oauth/connect?${new URLSearchParams({id})}`
}

export const serversAtom = Atom.keepAlive(
	RpcClient.runtime.atom(get =>
		withoutDeniedData(
			get,
			Stream.unwrap(Effect.map(RpcClient, client => client('gateway.servers', undefined))),
			WebRuntime.reconnecting
		)
	)
)

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
				const server = yield* (yield* RpcClient)('gateway.add', {url})
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

export const aiKeysAtom = RpcClient.query('ai.keys', undefined, {reactivityKeys: ['ai-keys']})

// A period's report now and after each recorded call; the server reopens the window at each bucket boundary.
export const aiUsageAtom = Atom.family((period: Period) =>
	Atom.keepAlive(
		RpcClient.runtime.atom(() =>
			Stream.unwrap(Effect.map(RpcClient, client => WebRuntime.reconnecting(client('ai.usage', period))))
		)
	)
)

export const mcpUsageAtom = Atom.family((period: Period) =>
	Atom.keepAlive(
		RpcClient.runtime.atom(() =>
			Stream.unwrap(Effect.map(RpcClient, client => WebRuntime.reconnecting(client('gateway.usage', period))))
		)
	)
)

export const setKeyAtom = RpcClient.runtime.fn((input: {provider: AiProvider; secret: string}) =>
	Reactivity.mutation(
		Effect.flatMap(RpcClient, client =>
			client('ai.setKey', {provider: input.provider, secret: Redacted.make(input.secret)})
		),
		['ai-keys']
	)
)

// The copy button's check, set by the copy and cleared a moment later.
export const copiedAtom = Atom.make(false)

// The button confirms a copy in place; a failure says why in a toast.
export const copyAtom = Atom.family((value: string) =>
	Atom.fn(() =>
		pipe(
			Effect.tryPromise({catch: cause => UpstreamError.make({cause}), try: () => navigator.clipboard.writeText(value)}),
			Effect.andThen(Atom.set(copiedAtom, true)),
			Effect.andThen(Effect.sleep('1500 millis')),
			Effect.andThen(Atom.set(copiedAtom, false)),
			Effect.tapError(() => Effect.sync(() => toast.add({description: value, title: 'Cannot copy', type: 'error'})))
		)
	)
)
