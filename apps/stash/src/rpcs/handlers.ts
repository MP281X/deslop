import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Notes} from '#services/notes/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		return RpcContracts.of({
			'notes.capture': input => Effect.flatMap(CurrentUser, user => notes.capture(user.id, input)),
			'notes.events': () => notes.events,
			'notes.get': input => notes.get(input.id),
			'notes.regenerate': input => Effect.flatMap(CurrentUser, user => notes.regenerate(user.id, input.id)),
			'notes.remove': input => notes.remove(input.id),
			'notes.search': input => notes.search(input.query)
		})
	})
)
