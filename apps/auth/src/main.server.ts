import {NodeCrypto, NodeHttpClient, NodeServices} from '@effect/platform-node'

import {Effect, Layer, pipe} from 'effect'

import {HttpMiddleware, HttpRouter, HttpServerRequest, HttpServerResponse} from 'effect/http'
import {RateLimiter} from 'effect/persistence'
import {RpcServer} from 'effect/rpc'

import {development} from '@deslop/runtime/auth/utils'
import {runApp} from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {GitHub} from '#services/github/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {fromAuth} from '#services/tokens/lib/utils.ts'
import {Tokens, layerStore} from '#services/tokens/service.ts'
import {layerMcp} from '#tools/handlers.ts'

const RpcOrigin = HttpRouter.middleware()(
	Effect.map(
		development,
		preview => app =>
			Effect.gen(function* () {
				if (!fromAuth((yield* HttpServerRequest.HttpServerRequest).headers, preview)) {
					return HttpServerResponse.text('The request comes from another origin', {status: 403})
				}
				return yield* app
			})
	)
)

// No other site may frame Auth's pages, so its Approve button cannot be clicked through a disguise.
const frameAncestors = HttpMiddleware.make(app =>
	Effect.map(app, HttpServerResponse.setHeader('content-security-policy', "frame-ancestors 'none'"))
)

// Each service builds on the ones below it: tokens, then people (who may use them), then sign-ins.
const layerServices = pipe(
	Layer.mergeAll(SignIns.layer, RateLimiter.layer),
	Layer.provideMerge(People.layer),
	Layer.provideMerge(Layer.mergeAll(Tokens.layer, GitHub.layer, RateLimiter.layerStoreMemory)),
	Layer.provide(layerStore)
)

runApp(
	'auth',
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
					ServerRuntime.layerIcon(icon),
					ServerRuntime.layerManifest('Auth'),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(layerServices)
			),
			{disableLogger: true, middleware: app => ServerRuntime.localGuard(frameAncestors(app))}
		),
		Layer.provide(Layer.mergeAll(NodeCrypto.layer, NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'})),
		Layer.provide(ServerRuntime.layer('@deslop/auth')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
