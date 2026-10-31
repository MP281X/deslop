import {NodeCrypto, NodeHttpClient, NodeRuntime, NodeServices} from '@effect/platform-node'

import {Config, Effect, FileSystem, Layer, Path, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpRouter} from 'effect/http'
import {RpcSerialization, RpcServer} from 'effect/rpc'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import packageJson from '#package.json' with {type: 'json'}

import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Extractor} from '#services/bookings/lib/extraction.ts'
import {Places} from '#services/bookings/lib/places.ts'
import {Bookings} from '#services/bookings/service.ts'
import {Push} from '#services/push/service.ts'
import {Tracker} from '#services/tracking/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// One data folder for the bookings, the push tokens and the airport list.
const layerStorage = Layer.unwrap(
	Effect.gen(function* () {
		const fs = yield* FileSystem.FileSystem
		const path = yield* Path.Path
		const directory = path.join(yield* Config.String('HOME'), '.deslop', 'trips')
		yield* fs.makeDirectory(directory, {mode: 0o700, recursive: true})
		return ServerRuntime.layerKeyValueStore(directory)
	})
)

const mcp = ServerRuntime.layerMcp({
	instructions: "Trips tracks the user's flights, trains and stays with live gates, delays and platforms.",
	name: 'trips',
	registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers)),
	version: packageJson.version
})

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(
			pipe(
				Layer.mergeAll(
					pipe(
						RpcServer.layerHttp({group: RpcContracts, path: '/api/rpc', protocol: 'websocket'}),
						Layer.provide(RpcHandlers),
						Layer.provide(RpcSerialization.layerJson)
					),
					mcp,
					ServerRuntime.layerIcon(icon)
				),
				Layer.provide(Auth.layer('https://trips.mp281x.xyz'))
			),
			{disableLogger: true}
		),
		Layer.provide(Layer.mergeAll(Push.layer, Tracker.layer)),
		Layer.provide(Bookings.layer),
		Layer.provide(Layer.mergeAll(Places.layer, Extractor.layer)),
		Layer.provide(layerStorage),
		Layer.provide(Layer.mergeAll(NodeCrypto.layer, NodeHttpClient.layerFetch, NodeServices.layer)),
		Layer.provide(ServerRuntime.layer('@deslop/trips')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
