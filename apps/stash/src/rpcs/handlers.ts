import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Notes} from '#services/notes/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		return RpcContracts.of({
			'notes.capture': notes.capture,
			'notes.remove': notes.remove,
			'notes.watch': () => notes.changes
		})
	})
)
