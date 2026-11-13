import {NodeHttpClient} from '@effect/platform-node'

import {Effect, Layer, Schema, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpServerResponse} from 'effect/http'
import {RateLimiter} from 'effect/persistence'

import {ADMINS, runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {Apps} from '#services/apps/service.ts'
import {GitHub} from '#services/github/service.ts'
import {Passkeys} from '#services/passkeys/service.ts'
import {People, layerIssuerAuth} from '#services/people/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tokens} from '#services/tokens/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers, layerMcpOwner} from '#tools/handlers.ts'

// Each service builds on the ones below it: tokens and passkeys, then people (who may use them), then sign-ins.
const layerServices = pipe(
	Layer.mergeAll(SignIns.layer, Layer.provide(RateLimiter.layer, RateLimiter.layerStoreMemory)),
	Layer.provideMerge(People.layer),
	Layer.provideMerge(Layer.mergeAll(Tokens.layer, Passkeys.layer, GitHub.layer, Apps.layer)),
	Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'}))
)

runApp({
	auth: Layer.provide(layerIssuerAuth, layerServices),
	icon,
	// No other site may frame Auth's pages, so its Approve button cannot be clicked through a disguise.
	middleware: app => Effect.map(app, HttpServerResponse.setHeader('content-security-policy', "frame-ancestors 'none'")),
	routes: Layer.provide(Layer.mergeAll(
			HttpHandlers,
			layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			layerMcp({
				instructions:
					'Use the matching list to identify a session, passkey or person. Use answer_sign_in only for an agent sign-in you started; browser sign-ins require the browser.',
				registrations: pipe(McpServer.toolkit(ToolContracts), Layer.provide(ToolHandlers), Layer.provide(layerMcpOwner))
			})
		), layerServices),
	settings: {
		GITHUB_ADMINS: ADMINS,
		GITHUB_CLIENT_ID: {
			description: "The GitHub app's client id",
			flag: 'github-client-id',
			schema: Schema.NonEmptyString
		}
	}
})
