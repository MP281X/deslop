import {Layer, pipe} from 'effect'

import {RpcServer} from 'effect/rpc'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import * as ServerRuntime from '@deslop/runtime/server'

export default pipe(
	RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
	Layer.provide(Layer.merge(RpcHandlers, ServerRuntime.layer('@deslop/template-app')))
)
