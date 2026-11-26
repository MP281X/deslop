import {Effect, Redacted, Schema, pipe} from 'effect'

import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {TimeFrame} from '@deslop/runtime/shared/time'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {RpcContracts} from '#rpcs/contracts.ts'
import {AiSetKey} from '#services/ai-proxy/schema.ts'
import {ServerId, ServerUrl} from '#services/connections/schema.ts'

addPageTelemetry('@deslop/gateway')

class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/lib/gateway/RpcClient', {
	group: RpcContracts.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

export const serversAtom = Atom.keepAlive(liveAtom(RpcClient, 'connections.watch'))
export const aiKeyAtom = Atom.keepAlive(liveAtom(RpcClient, 'ai-proxy.key'))

// A period's report now and after each recorded call; the server reopens the window at each bucket boundary.
export const aiUsageAtom = Atom.family((period: TimeFrame) => liveAtom(RpcClient, 'ai-metering.usage', period))
export const mcpUsageAtom = Atom.family((period: TimeFrame) => liveAtom(RpcClient, 'connections.usage', period))

type Entry = typeof Entry.Type
export const Entry = Schema.Redacted(Schema.String)

export type Action = typeof Action.Type
export const Action = Schema.TaggedUnion({AddServer: {url: Entry}, Connect: {id: ServerId}, SaveKey: {input: AiSetKey}})

function leaving(id: ServerId) {
	return Effect.andThen(
		Effect.sync(() => location.assign(`/oauth/connect?${new URLSearchParams({id})}`)),
		// Authorization has started; keep the action pending until the document leaves.
		Effect.never
	)
}

const addServer = Effect.fnUntraced(function* (entry: Entry) {
	const url = yield* Effect.mapError(Schema.decodeEffect(ServerUrl)(Redacted.value(entry)), cause =>
		AuthError.make({
			cause,
			message: 'Enter a public HTTPS MCP URL without credentials or a fragment, outside the gateway itself.'
		})
	)
	const server = yield* Effect.flatMap(RpcClient, call => call('connections.add', {url}))
	if (server.status !== 'Connected') return yield* leaving(server.id)
})

const actionAtom = RpcClient.runtime.fn((action: Action) =>
	Action.match(action, {
		AddServer: request => addServer(request.url),
		Connect: request => leaving(request.id),
		SaveKey: request => Effect.flatMap(RpcClient, call => call('ai-proxy.setKey', request.input))
	})
)

export const execute = Effect.fnUntraced(function* (registry: AtomRegistry.AtomRegistry, action: Action) {
	registry.set(actionAtom, action)
	return yield* pipe(
		registry,
		AtomRegistry.getResult(actionAtom, {suspendOnWaiting: true}),
		Effect.ensuring(Effect.sync(() => registry.set(actionAtom, Atom.Reset)))
	)
})
