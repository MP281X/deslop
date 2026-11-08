import {Boolean, Clock, Effect, Option, Redacted, Schema, Stream, pipe} from 'effect'

import {Machine} from '@typeonce/effect-machine'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult, Atom, AtomRpc, Reactivity} from 'effect/reactivity'

import {toast} from '@deslop/components-web/ui/toast'
import {AuthError} from '@deslop/runtime/auth/schema'
import {withoutDeniedData} from '@deslop/runtime/auth/utils'
import * as WebRuntime from '@deslop/runtime/web'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {AiProvider} from '#services/ai/schema.ts'
import {ServerUrl, UpstreamError} from '#services/connections/schema.ts'

export const ENDPOINT = `${window.location.origin}/mcp`

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/lib/utils/RpcClient', {
	group: RpcContracts,
	protocol: WebRuntime.layer('@deslop/gateway')
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

// Every tool call through the gateway, numbered, so a server called twice in a row lights twice.
const callsAtom = Atom.keepAlive(
	RpcClient.runtime.atom(
		Stream.zipWithIndex(
			WebRuntime.reconnecting(Stream.unwrap(Effect.map(RpcClient, client => client('gateway.calls', undefined))))
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

export type Period = typeof Period.Type
export const Period = Schema.Literals(['24h', '7d', '30d'])

// The period's buckets, ending with the current one: hours for a day, UTC days otherwise.
function periodRange(period: Period, now: number) {
	const bucket = Boolean.match(period === '24h', {onFalse: () => 'day' as const, onTrue: () => 'hour' as const})
	const size = Boolean.match(bucket === 'hour', {onFalse: () => 86_400_000, onTrue: () => 3_600_000})
	const count = {'7d': 7, '24h': 24, '30d': 30}[period]
	const to = (Math.floor(now / size) + 1) * size
	return {bucket, count, from: to - count * size, size, to}
}

export const aiKeysAtom = RpcClient.query('ai.keys', undefined, {reactivityKeys: ['ai-keys']})
export const aiGrantsAtom = RpcClient.query('ai.grants', undefined, {reactivityKeys: ['ai-grants']})

// One reader per period, its range taken when it runs, so a refresh moves the window to now.
export const aiUsageAtom = Atom.family((period: Period) =>
	pipe(
		RpcClient.runtime.atom(
			Effect.gen(function* () {
				const range = periodRange(period, yield* Clock.currentTimeMillis)

				return {
					range,
					report: yield* (yield* RpcClient)('ai.usage', {bucket: range.bucket, from: range.from, to: range.to})
				}
			})
		),
		Atom.withReactivity(['ai-usage'])
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

// One per provider or app, so a failure stays with the dialog that caused it.
export const removeKeyAtom = Atom.family((provider: AiProvider) =>
	RpcClient.runtime.fn(() =>
		Reactivity.mutation(
			Effect.flatMap(RpcClient, client => client('ai.removeKey', {provider})),
			['ai-keys']
		)
	)
)
export const revokeGrantAtom = Atom.family((app: string) =>
	RpcClient.runtime.fn(() =>
		Reactivity.mutation(
			Effect.flatMap(RpcClient, client => client('ai.revokeGrant', {app})),
			['ai-grants']
		)
	)
)

// A copy confirms in place for a moment, on touch too; a failure says why in a toast.
export const copyAtom = Atom.family((value: string) =>
	Atom.fn(() =>
		pipe(
			Effect.tryPromise({catch: cause => UpstreamError.make({cause}), try: () => navigator.clipboard.writeText(value)}),
			// The palette closes as it runs, so the toast is the only place the copy can be confirmed.
			Effect.tap(() => Effect.sync(() => toast.add({description: value, title: 'Copied', type: 'success'}))),
			Effect.tapError(() => Effect.sync(() => toast.add({description: value, title: 'Cannot copy', type: 'error'})))
		)
	)
)
