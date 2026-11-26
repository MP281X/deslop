import {NodeHttpClient} from '@effect/platform-node'

import {Effect, Layer, Schema, pipe} from 'effect'

import {McpServer, Toolkit} from 'effect/ai'
import {HttpServerResponse} from 'effect/http'

import {Auth, identifyRequestOf} from '@deslop/runtime/server/auth'
import {runApp} from '@deslop/runtime/server/cli'
import {layerMcp, layerRpc} from '@deslop/runtime/server/http'

import {RpcContracts} from '#contracts'

import {GitHub} from '#server/github/service.ts'
import {IdentityHttp} from '#server/identity/http.ts'
import {IdentityRpcHandlers} from '#server/identity/rpcs.ts'
import {Identity} from '#server/identity/service.ts'
import {PeopleRpcHandlers} from '#server/people/rpcs.ts'
import {People} from '#server/people/service.ts'
import {PeopleToolHandlers, PeopleTools} from '#server/people/tools.ts'
import {SessionsRpcHandlers} from '#server/sessions/rpcs.ts'
import {Sessions} from '#server/sessions/service.ts'
import {SessionToolHandlers, SessionTools} from '#server/sessions/tools.ts'
import {SignInsHttp} from '#server/sign-ins/http.ts'
import {SignIns} from '#server/sign-ins/service.ts'
import {Tailnet} from '#server/tailnet/service.ts'
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

const tools = Toolkit.merge(PeopleTools, SessionTools)

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
			IdentityHttp,
			SignInsHttp,
			layerRpc({
				group: RpcContracts,
				handlers: Layer.mergeAll(IdentityRpcHandlers, PeopleRpcHandlers, SessionsRpcHandlers)
			}),
			layerMcp({
				contracts: tools,
				instructions: 'Manage people as an admin, and list or sign out your browser sessions.',
				registrations: Layer.provide(McpServer.toolkit(tools), Layer.merge(PeopleToolHandlers, SessionToolHandlers))
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
