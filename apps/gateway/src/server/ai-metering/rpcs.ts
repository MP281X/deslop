import {Effect, Stream} from 'effect'

import {CurrentUser} from '@deslop/runtime/shared/auth'

import {AiMeteringRpcs} from '#contracts'

import {AiMetering} from '#server/ai-metering/service.ts'

export const AiMeteringHandlers = AiMeteringRpcs.toLayer(
	Effect.gen(function* () {
		const metering = yield* AiMetering
		return AiMeteringRpcs.of({
			'ai-metering.usage': period => Stream.unwrap(Effect.map(CurrentUser, user => metering.usage(user.id, period)))
		})
	})
)
