import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'

import HttpApplication from './main.server.ts'

import * as ServerRuntime from '@deslop/runtime/server'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(HttpApplication, {disableLogger: true}),
		Layer.provide(ServerRuntime.layer('@deslop/stash')),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
