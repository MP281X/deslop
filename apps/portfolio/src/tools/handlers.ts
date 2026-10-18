import {Effect} from 'effect'

import {Presence} from '#services/presence/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.gen(function* () {
		const presence = yield* Presence
		return Tools.of({visitors: () => Effect.map(presence.visitors, visitors => ({visitors}))})
	})
)
