import {NodeRuntime} from '@effect/platform-node'

import {Layer, pipe} from 'effect'

import {HttpRouter} from 'effect/http'

import HttpApplication from './main.server.ts'

import * as ServerRuntime from '@deslop/runtime/server'

NodeRuntime.runMain(
	pipe(
		HttpRouter.serve(Layer.merge(HttpApplication, ServerRuntime.layerStaticFiles), {disableLogger: true}),
		Layer.provide(ServerRuntime.layerNodeHttpServer),
		Layer.launch
	)
)
