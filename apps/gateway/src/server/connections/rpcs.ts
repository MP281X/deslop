import {Effect, Stream} from 'effect'

import {CurrentAdmin} from '@deslop/runtime/shared/auth'

import {ConnectionRpcs} from '#contracts'

import {Connections} from '#server/connections/service.ts'
import {Gateway} from '#server/gateway/service.ts'

export const ConnectionHandlers = ConnectionRpcs.toLayer(
	Effect.gen(function* () {
		const connections = yield* Connections
		const gateway = yield* Gateway
		return ConnectionRpcs.of({
			'connections.add': Effect.fnUntraced(function* (input, options) {
				const added = yield* connections.add(input.url, yield* CurrentAdmin, options.headers)
				// A new server's tools are read now, so its first list is not empty.
				yield* gateway.connected(options.headers)
				return added
			}),
			'connections.usage': period => Stream.unwrap(Effect.map(CurrentAdmin, admin => connections.usage(period, admin))),
			'connections.watch': () => Stream.unwrap(Effect.map(CurrentAdmin, connections.watch))
		})
	})
)
