import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Chapters} from '#services/chapters/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const chapters = yield* Chapters
		return RpcContracts.of({
			'chapters.events': () => chapters.events,
			'chapters.read': input => chapters.read(input),
			'chapters.register': input => chapters.register(input)
		})
	})
)
