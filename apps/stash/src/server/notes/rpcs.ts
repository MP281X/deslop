import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {RpcContracts} from '#contracts'

import {Notes} from '#server/notes/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const notes = yield* Notes
		return RpcContracts.of({
			'notes.body': input => notes.body(input.id),
			'notes.capture': input => Effect.flatMap(CurrentUser, user => notes.capture(user.id, input)),
			'notes.events': () => notes.events,
			'notes.media': input => notes.media(input.id),
			'notes.regenerate': input => Effect.flatMap(CurrentUser, user => notes.regenerate(user.id, input.id))
		})
	})
)
