import {Layer, pipe} from 'effect'

import {RpcClient, RpcSerialization} from 'effect/rpc'
import type {Socket} from 'effect/socket'

import {layerRpcStreamClient} from '#shared/rpc.ts'

// The one RPC transport of the web and iOS clients: binary frames over a socket that reopens after a transient drop; iOS supplies its guarded session handshake.
export function layerSocketProtocol(socket: Layer.Layer<Socket.Socket>) {
	return pipe(
		// The default ping timeout equals the 5-second ping interval, so any pong delay closes the socket.
		RpcClient.layerProtocolSocket({pingTimeout: '15 seconds', retryTransientErrors: true}),
		Layer.provide(socket),
		Layer.provideMerge(RpcSerialization.layerSchemaBinary()),
		Layer.provideMerge(layerRpcStreamClient)
	)
}
