import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Chapters} from '#services/chapters/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const chapters = yield* Chapters
		return RpcContracts.of({
			'chapters.read': input => chapters.read(input),
			'chapters.watch': () => chapters.changes,
			'devices.register': input => chapters.register(input.token)
		})
	})
)
