import {Effect} from 'effect'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Chapters} from '#services/chapters/service.ts'
import {Reading} from '#services/reading/service.ts'

export const RpcHandlers = RpcContracts.toLayer(
	Effect.gen(function* () {
		const chapters = yield* Chapters
		const reading = yield* Reading
		return RpcContracts.of({
			'chapters.events': () => chapters.events,
			'chapters.register': input => chapters.register(input),
			'reading.write': input => reading.write(input)
		})
	})
)
