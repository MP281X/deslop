import {Layer, pipe} from 'effect'
import type {Effect} from 'effect'

import {RpcClient, RpcSerialization} from 'effect/rpc'
import {Socket} from 'effect/socket'

import {layerRpcStreamClient} from '#shared/rpc.ts'

// The one RPC transport of the web and iOS clients: binary frames over a WebSocket that reopens after a transient drop.
export function layerSocketProtocol(url: string | Effect.Effect<string>) {
	return pipe(
		// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
		RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
		Layer.provide(Layer.provide(Socket.layerWebSocket(url), Socket.layerWebSocketConstructorGlobal)),
		Layer.provideMerge(RpcSerialization.layerSchemaBinary()),
		Layer.provideMerge(layerRpcStreamClient)
	)
}
