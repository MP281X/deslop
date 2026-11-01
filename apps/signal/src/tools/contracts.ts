import {Tool, Toolkit} from 'effect/ai'

import {GameError, Timeline, UsageLedger} from '#services/game/schema.ts'

export const Tools = Toolkit.make(
	Tool.make('get_timeline', {
		description: 'Current simulation timeline and replay bounds; does not join or advance the game.',
		success: Timeline
	}).annotate(Tool.Readonly, true),
	Tool.make('get_usage', {
		description: 'Simulation model usage and recorded costs.',
		failure: GameError,
		success: UsageLedger
	}).annotate(Tool.Readonly, true)
)
