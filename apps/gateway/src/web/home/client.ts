import {Atom, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {TimeFrame} from '@deslop/runtime/shared/time'
import {addPageTelemetry, layerPageProtocol} from '@deslop/runtime/web/client'

import {GatewayRpcs} from '#contracts'

addPageTelemetry('@deslop/gateway')

export class RpcClient extends AtomRpc.Service<RpcClient>()('@deslop/gateway/web/home/client/RpcClient', {
	group: GatewayRpcs.middleware(RpcStream),
	protocol: layerPageProtocol
}) {}

export const serversAtom = Atom.keepAlive(liveAtom(RpcClient, 'connections.watch'))
export const aiKeyAtom = Atom.keepAlive(liveAtom(RpcClient, 'ai-proxy.key'))

// A period's report now and after each recorded call; the server reopens the window at each bucket boundary.
export const aiUsageAtom = Atom.family((period: TimeFrame) => liveAtom(RpcClient, 'ai-metering.usage', period))
export const mcpUsageAtom = Atom.family((period: TimeFrame) => liveAtom(RpcClient, 'connections.usage', period))
