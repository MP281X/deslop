import {Effect, Stream} from 'effect'

import {SqlClient} from 'effect/sql'

import {identifyRequestOf} from '@deslop/runtime/server/auth'

import {IdentityRpcs} from '#contracts'

import {Identity} from '#server/identity/service.ts'

export const IdentityRpcHandlers = IdentityRpcs.toLayer(
	Effect.gen(function* () {
		const identity = yield* Identity
		const sql = yield* SqlClient.SqlClient
		return {
			'people.account': (_, options) =>
				Stream.buffer(
					sql.reactive(['people', 'sessions'], identity.resolve(identifyRequestOf(options.headers), true)),
					{capacity: 1, strategy: 'sliding'}
				)
		}
	})
)
