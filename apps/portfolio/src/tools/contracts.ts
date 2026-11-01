import {Tool, Toolkit} from 'effect/ai'

import {PortfolioVisitors} from '#services/presence/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('list_visitors', {
		description: 'Current portfolio cursors, without joining the room or changing its visitors.',
		success: PortfolioVisitors
	}).annotate(Tool.Readonly, true)
)
