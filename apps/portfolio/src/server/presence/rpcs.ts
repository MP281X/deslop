import {Effect} from 'effect'

import {RpcContracts} from '#contracts'

import {Presence} from '#server/presence/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const presence = yield* Presence
		return RpcContracts.of({
			'presence.join': (payload, options) => presence.join(payload, options.client.id),
			'presence.move': (payload, options) => presence.move(payload, options.client.id),
			'presence.recolor': (payload, options) => presence.recolor(payload, options.client.id)
		})
	})
)
