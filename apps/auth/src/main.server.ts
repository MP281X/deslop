import {NodeHttpClient} from '@effect/platform-node'

import {Effect, Layer, Schema, pipe} from 'effect'

import {McpServer} from 'effect/ai'
import {HttpServerResponse} from 'effect/http'

import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {HttpHandlers} from '#http/handlers.ts'
import icon from '#routes/icon.svg'
import {RpcContracts} from '#rpcs/contracts.ts'
import {RpcHandlers} from '#rpcs/handlers.ts'
import {GitHub} from '#services/github/service.ts'
import {Identity, layerIdentityAuth} from '#services/identity/service.ts'
import {People} from '#services/people/service.ts'
import {Sessions} from '#services/sessions/service.ts'
import {SignIns} from '#services/sign-ins/service.ts'
import {Tailnet} from '#services/tailnet/service.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

// Identity resolves people through shared cookie sessions or the tailnet.
const layerServices = pipe(
	SignIns.layer,
	Layer.provideMerge(Identity.layer),
	Layer.provide(Tailnet.layer),
	Layer.provideMerge(People.layer),
	Layer.provideMerge(Layer.mergeAll(Sessions.layer, GitHub.layer)),
	Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'}))
)

runApp({
	auth: Layer.provide(layerIdentityAuth, layerServices),
	icon,
	// Access requests cannot be approved through a framing site.
	middleware: app => Effect.map(app, HttpServerResponse.setHeader('content-security-policy', "frame-ancestors 'none'")),
	routes: Layer.provide(
		Layer.mergeAll(
			HttpHandlers,
			layerRpc({group: RpcContracts, handlers: RpcHandlers}),
			layerMcp({
				contracts: ToolContracts,
				instructions: 'Manage people as an admin, and list or sign out your browser sessions.',
				registrations: Layer.provide(McpServer.toolkit(ToolContracts), ToolHandlers)
			})
		),
		layerServices
	),
	settings: {
		GITHUB_ADMINS: {
			description: 'GitHub user ids, comma-separated, who admit people and manage shared settings',
			flag: 'admins',
			schema: Schema.String.check(Schema.isPattern(/^\d+(?:,\d+)*$/u))
		},
		GITHUB_CLIENT_ID: {
			description: "The GitHub app's client id",
			flag: 'github-client-id',
			schema: Schema.NonEmptyString
		}
	}
})
