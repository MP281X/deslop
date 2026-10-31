import {NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Boolean, Config, Effect, Layer, Path, pipe} from 'effect'

import {HttpRouter} from 'effect/http'
import {RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Core} from '#services/core/service.ts'
import {Game} from '#services/game/service.ts'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers)
					),
					ServerRuntime.layerIcon(icon),
					ServerRuntime.layerManifest('Signal'),
					ServerRuntime.layerStaticFiles
				),
				Layer.provide(Auth.layer('https://signal.mp281x.xyz'))
			),
			{disableLogger: true}
		),
		Layer.provide(ServerRuntime.layer('@deslop/signal')),
		Layer.provide(Game.layer),
		Layer.provide(Core.layer),
		Layer.provide(
			Layer.unwrap(
				Effect.gen(function* () {
					const path = yield* Path.Path
					const production =
						(yield* pipe(Config.String('NODE_ENV'), Config.withDefault('development'))) === 'production'
					return ServerRuntime.layerKeyValueStore(
						yield* pipe(
							Config.String('SIGNAL_DATA'),
							Config.withDefault(
								path.join(
									yield* Config.String('HOME'),
									'.deslop',
									Boolean.match(production, {onFalse: () => 'signal-development', onTrue: () => 'signal'})
								)
							)
						)
					)
				})
			)
		),
		Layer.provide(Layer.mergeAll(NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
