import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Notes} from '#services/notes/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		return RpcContracts.of({
			'notes.capture': input => notes.capture(input),
			'notes.get': input => notes.get(input),
			'notes.regenerate': input => notes.regenerate(input),
			'notes.remove': input => notes.remove(input),
			'notes.search': input => notes.search(input),
			'notes.watch': () => notes.events
		})
	})
)
