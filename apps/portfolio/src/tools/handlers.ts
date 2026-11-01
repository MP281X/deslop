import {Effect} from 'effect'

import {Presence} from '#services/presence/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.map(Presence, presence => Tools.of({list_visitors: () => presence.snapshot}))
)
