import {NodeHttpClient} from '@effect/platform-node'

import {Effect, Layer, Schema, pipe} from 'effect'

import {McpServer, Toolkit} from 'effect/ai'
import {HttpServerResponse} from 'effect/http'

import {Auth, identifyRequestOf} from '@deslop/runtime/server/auth'
import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {GitHub} from '#github/server.ts'
import {identityHandlers, identityHttp} from '#identity/handlers.ts'
import {Identity} from '#identity/server.ts'
import {peopleHandlers, peopleToolHandlers, peopleTools} from '#people/handlers.ts'
import {People} from '#people/server.ts'
import {sessionsToolHandlers, sessionsTools, sessionsHandlers} from '#sessions/handlers.ts'
import {Sessions} from '#sessions/server.ts'
import {signInsHttp} from '#sign-ins/handlers.ts'
import {SignIns} from '#sign-ins/server.ts'
import {Tailnet} from '#tailnet/server.ts'
import icon from '#web/icon.svg'

// Identity resolves people through shared cookie sessions or the tailnet.
const layerServices = pipe(
	SignIns.layer,
	Layer.provideMerge(Identity.layer),
	Layer.provide(Tailnet.layer),
	Layer.provideMerge(People.layer),
	Layer.provideMerge(Layer.mergeAll(Sessions.layer, GitHub.layer)),
	Layer.provide(Layer.succeed(NodeHttpClient.RequestInit, {redirect: 'error'}))
)

const toolkit = Toolkit.merge(peopleTools, sessionsTools)

runApp({
	auth: Layer.provide(
		Layer.effectContext(
			Effect.map(Identity, identity =>
				Auth.makeContext(headers => Effect.withSpan(identity.resolve(identifyRequestOf(headers)), 'Identity.account'))
			)
		),
		layerServices
	),
	icon,
	// Access requests cannot be approved through a framing site.
	middleware: app => Effect.map(app, HttpServerResponse.setHeader('content-security-policy', "frame-ancestors 'none'")),
	routes: Layer.provide(
		Layer.mergeAll(
			identityHttp,
			signInsHttp,
			layerRpc({group: RpcContracts, handlers: Layer.mergeAll(identityHandlers, peopleHandlers, sessionsHandlers)}),
			layerMcp({
				contracts: toolkit,
				instructions: 'Manage people as an admin, and list or sign out your browser sessions.',
				registrations: Layer.provide(McpServer.toolkit(toolkit), Layer.merge(peopleToolHandlers, sessionsToolHandlers))
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
