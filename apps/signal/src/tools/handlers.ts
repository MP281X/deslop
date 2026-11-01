import {Effect} from 'effect'

import {Game} from '#services/game/service.ts'
import {Tools} from '#tools/contracts.ts'

export const ToolHandlers = Tools.toLayer(
	Effect.map(Game, game => Tools.of({get_timeline: () => game.timeline, get_usage: () => game.usage}))
)
