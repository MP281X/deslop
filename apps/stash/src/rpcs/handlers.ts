import {Effect, Stream} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {UserNotes} from '#services/notes/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const notes = (yield* UserNotes).current
		return RpcContracts.of({
			'notes.capture': input => Effect.flatMap(notes, service => service.capture(input)),
			'notes.get': input => Effect.flatMap(notes, service => service.get(input)),
			'notes.regenerate': input => Effect.flatMap(notes, service => service.regenerate(input)),
			'notes.remove': input => Effect.flatMap(notes, service => service.remove(input)),
			'notes.search': input => Effect.flatMap(notes, service => service.search(input)),
			'notes.watch': () => Stream.unwrap(Effect.map(notes, service => service.events))
		})
	})
)
