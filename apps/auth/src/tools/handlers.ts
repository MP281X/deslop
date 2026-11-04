import {Effect} from 'effect'

import {CurrentUser} from '@deslop/runtime/auth/utils'

import {SignIns} from '#services/sign-ins/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const signIns = yield* SignIns
		return Tools.of({
			answer_request: Effect.fnUntraced(function* (input) {
				return yield* signIns.answer(input, yield* CurrentUser, 'Token')
			})
		})
	})
)
