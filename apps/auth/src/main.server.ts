import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Effect, Layer, pipe} from 'effect'

import {HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {AUTH_URL} from '@deslop/runtime/auth/utils'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Changes} from '#services/changes/service.ts'
import {Connections} from '#services/connections/service.ts'
import {Gateway} from '#services/gateway/service.ts'
import {GitHub} from '#services/github/service.ts'
import {layerPublicFetch} from '#services/network/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tokens, layerStore} from '#services/tokens/service.ts'
import {layerMcp} from '#tools/handlers.ts'

const RpcOrigin = HttpRouter.middleware()(
	Effect.succeed(app =>
		Effect.gen(function* () {
			if ((yield* HttpServerRequest.HttpServerRequest).headers['origin'] !== AUTH_URL) {
				return HttpServerResponse.text('The request comes from another origin', {status: 403})
			}
			return yield* app
		})
	)
)

// Each service builds on the ones below it: tokens, then people (who may use them), sign-ins and connections, then the gateway.
const layerServices = pipe(
	Layer.mergeAll(Gateway.layer, SignIns.layer),
	Layer.provideMerge(Connections.layer),
	Layer.provideMerge(People.layer),
	Layer.provideMerge(Layer.merge(Tokens.layer, GitHub.layer)),
	Layer.provideMerge(Changes.layer),
	Layer.provide(layerStore)
)

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					HttpHandlers,
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers),
						Layer.provide(RpcOrigin.layer)
					),
					layerMcp,
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(layerServices)
			),
			{disableLogger: true}
		),
		Layer.provide(Layer.mergeAll(NodeCrypto.layer, NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'})),
		Layer.provide(layerPublicFetch),
		Layer.provide(ServerRuntime.layer('@deslop/auth')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
