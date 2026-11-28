import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {AiMeteringRpcs} from './contract.ts'
import {AiMetering} from './server.ts'

export const aiMeteringHandlers = AiMeteringRpcs.toLayer(
	Effect.gen(function* () {
		const metering = yield* AiMetering
		return AiMeteringRpcs.of({
			'ai-metering.usage': period => Stream.unwrap(Effect.map(CurrentUser, user => metering.usage(user.id, period)))
		})
	})
)
