import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Chapters} from '#services/chapters/service.ts'
import {Push} from '#services/push/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const chapters = yield* Chapters
		const push = yield* Push
		return RpcContracts.of({
			'chapters.events': () => chapters.events,
			'chapters.write': input => chapters.write(input),
			'push.register': input => push.register(input)
		})
	})
)
