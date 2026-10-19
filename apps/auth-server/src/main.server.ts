import {NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Effect, Layer, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/auth/service'
import {AUTH_URL} from '@deslop/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'

const RpcOrigin = HttpRouter.middleware()(
	Effect.gen(function* () {
		const origin = new URL(yield* pipe(Config.String('AUTH_URL'), Config.withDefault(AUTH_URL))).origin
		return app =>
			Effect.gen(function* () {
				if ((yield* HttpServerRequest.HttpServerRequest).headers['origin'] !== origin) {
					return HttpServerResponse.text('The request comes from another origin', {status: 403})
				}
				return yield* app
			})
	})
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.merge(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers),
						Layer.provide(RpcOrigin.layer)
					),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(Auth.layerIssuer)
			),
			{disableLogger: true}
		),
		Layer.provide(Layer.mergeAll(NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/auth-server')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
