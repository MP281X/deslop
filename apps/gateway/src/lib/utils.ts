import {Boolean, Effect, Option, Schedule, Schema, Stream, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom, AtomRpc} from 'effect/reactivity'

import {AuthError} from '@deslop/runtime/auth/schema'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import {ServerUrl} from '#services/connections/schema.ts'

export const ENDPOINT = `${window.location.origin}/mcp`

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/gateway')
}) {}

export function connectUrl(id: string) {
	return `/oauth/connect?${new URLSearchParams({id})}`
}

// Opened again after the socket drops; a sign-in or admin failure reaches the screen.
function reconnecting<A, E extends {_tag: string}, R>(stream: Stream.Stream<A, E, R>) {
	return Stream.retry(stream, $ =>
		pipe(
			$(Schedule.spaced('1 second')),
			Schedule.while(metadata => metadata.input._tag === 'RpcClientError')
		)
	)
}

export const serversAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		reconnecting(Stream.unwrap(Effect.map(RpcClient, client => client('gateway.servers', undefined))))
	)
)

// Every tool call through the gateway, numbered, so a server called twice in a row lights twice.
const callsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		reconnecting(
			Stream.zipWithIndex(Stream.unwrap(Effect.map(RpcClient, client => client('gateway.calls', undefined))))
		)
	)
)

// The number of one server's latest call, or -1 before any; its dot dims each time it changes.
export const lastCallAtom = Atom.family((id: string) =>
	Atom.make(get => {
		const previous = Option.getOrElse(get.self<number>(), () => -1)
		return AsyncResult.match(get(callsAtom), {
			onFailure: () => previous,
			onInitial: () => previous,
			onSuccess: latest =>
				Boolean.match(latest.value[0] === id, {onFalse: () => previous, onTrue: () => latest.value[1]})
		})
	})
)

export const disconnectAtom = Atom.family((id: string) =>
	RpcClient.runtime.fn(() => Effect.flatMap(RpcClient, client => client('gateway.disconnect', {id})))
)
export const hideAtom = Atom.family((id: string) =>
	// Concurrent, so a second toggle while the first is in flight does not interrupt it.
	RpcClient.runtime.fn(
		(change: {hidden: boolean; tool: string}) =>
			Effect.flatMap(RpcClient, client => client('gateway.hide', {...change, id})),
		{concurrent: true}
	)
)
export const removeAtom = Atom.family((id: string) =>
	RpcClient.runtime.fn(() => Effect.flatMap(RpcClient, client => client('gateway.remove', {id})))
)

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
		events: Machine.events({Cancel: {}, Open: {}, Submit: {}, Typed: {url: Schema.String}}),
		root: Machine.state({
			states: {
				Adding: {fields: {url: Schema.String}},
				Closed: {},
				Editing: {fields: {error: Schema.String, url: Schema.String}}
			}
		})
	}).handle({
		initial: {target: 'Closed'},
		states: {
			Adding: {
				invoke: {
					input: transition => transition.state.url,
					onDone: {target: 'Closed'},
					onFailure: {
						data: transition => ({error: transition.error.message, url: transition.state.url}),
						target: 'Editing'
					},
					src: 'add'
				}
			},
			Closed: {on: {Open: {data: {error: '', url: ''}, target: 'Editing'}}},
			Editing: {
				on: {
					Cancel: {target: 'Closed'},
					Submit: {data: transition => ({url: transition.state.url}), target: 'Adding'},
					Typed: {data: transition => ({error: '', url: transition.event.url}), update: 'Editing'}
				}
			}
		}
	})
)

export const copyEndpointAtom = Atom.fn(() =>
	Effect.tryPromise({
		catch: cause =>
			AuthError.make({cause, message: 'Cannot copy the gateway endpoint. Select and copy its URL instead.'}),
		try: () => navigator.clipboard.writeText(ENDPOINT)
	})
)
