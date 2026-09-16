import {Layer, pipe} from 'effect'

import {RpcServer} from 'effect/unstable/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'

export default pipe(
	RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
	Layer.provide(RpcHandlers)
)
