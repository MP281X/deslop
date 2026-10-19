import {Schema} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {PortfolioVisitor} from '#services/presence/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('visitors', {
		description:
			"List the people on the portfolio now, with their cursor's position from 0 to 1 across the page. The server's two demo cursors are left out.",
		success: Schema.Struct({visitors: Schema.Array(PortfolioVisitor)})
	}).annotate(Tool.Readonly, true)
)
