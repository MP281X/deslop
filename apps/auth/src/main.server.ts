import {NodeHttpClient} from '@effect/platform-node'

import {Effect, Layer, Schema, pipe} from 'effect'

import {HttpServerResponse} from 'effect/http'
import {RateLimiter} from 'effect/persistence'

import * as CliRuntime from '@deslop/runtime/cli'
import * as ServerRuntime from '@deslop/runtime/server'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Apps} from '#services/apps/service.ts'
import {GitHub} from '#services/github/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {People} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tokens} from '#services/tokens/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// Each service builds on the ones below it: tokens and passkeys, then people (who may use them), then sign-ins.
const layerServices = pipe(
	Layer.mergeAll(SignIns.layer, RateLimiter.layer),
	Layer.provideMerge(People.layer),
	Layer.provideMerge(
		Layer.mergeAll(Tokens.layer, Passkeys.layer, GitHub.layer, Apps.layer, RateLimiter.layerStoreMemory)
	),
	Layer.provide(ServerRuntime.layerDataStore),
	Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'}))
)

CliRuntime.runApp({
	icon,
	// No other site may frame Auth's pages, so its Approve button cannot be clicked through a disguise.
	middleware: app => Effect.map(app, HttpServerResponse.setHeader('content-security-policy', "frame-ancestors 'none'")),
	routes: pipe(
		Layer.mergeAll(
			HttpHandlers,
			ServerRuntime.layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			ServerRuntime.layerMcp({
				handlers: ToolHandlers,
				instructions: 'Approve a sign-in you started with answer_request.',
				tools: Tools
			})
		),
		Layer.provide(layerServices)
	),
	settings: {
		GITHUB_ADMINS: CliRuntime.ADMINS,
		GITHUB_CLIENT_ID: {
			description: "The GitHub app's client id",
			flag: 'github-client-id',
			schema: Schema.NonEmptyString
		}
	}
})
