import {Array, Clock, Effect, Layer, Option, pipe} from 'effect'

import {McpServer} from 'effect/ai'

import {Auth} from '@deslop/runtime/auth/service'
import * as ServerRuntime from '@deslop/runtime/server'

import {connectionStatus, summary} from '#services/connections/lib/utils.ts'
import {Connections} from '#services/connections/service.ts'
import {GatewayDiscovery, VerifiedCaller} from '#services/gateway/service.ts'
import {Tools} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

export const GatewayMcp = Layer.unwrap(
	Effect.gen(function* () {
		const now = yield* Clock.currentTimeMillis
		const auth = yield* Auth
		// One tools/list verifies its bearer in the discovery middleware; the MCP auth middleware reads the same answer.
		const cached = Auth.of({
			token: headers => auth.token(headers),
			user: headers =>
				Effect.gen(function* () {
					const saved = Option.getOrUndefined(yield* VerifiedCaller)
					if (saved?.key === (headers['authorization'] ?? '')) return yield* Effect.fromResult(saved.result)
					return yield* auth.user(headers)
				})
		})
		return pipe(
			ServerRuntime.layerMcp({
				instructions: Array.join(
					[
						"Gateway holds the user's MCP servers, provider keys and AI usage; start with list_mcp_connections, and upstream tools are named <server>__<tool>.",
						...Array.map(
							Array.filter(
								yield* (yield* Connections).definitions,
								server => connectionStatus(server, now) === 'Connected'
							),
							server => `${server.id}: ${summary(server)}`
						)
					],
					'\n'
				),
				registrations: pipe(McpServer.toolkit(Tools), Layer.provide(ToolHandlers))
			}),
			Layer.provide(GatewayDiscovery.layer),
			Layer.provide(McpServer.McpServer.layer),
			Layer.provide(Layer.succeed(Auth, cached))
		)
	})
)
