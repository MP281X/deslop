import {Array, Record} from 'effect'

import type {UsageLedger} from '#services/game/schema.ts'

export function spendOf(ledger: UsageLedger, mode: string) {
	const models = Array.map(
		Record.toEntries(
			Array.groupBy(
				Array.filter(Record.values(ledger.groups), group => group.mode === mode),
				group => group.model
			)
		),
		pair => ({
			calls: Array.reduce(pair[1], 0, (total, group) => total + group.calls),
			cost: Array.reduce(pair[1], 0, (total, group) => total + group.values.cost.total),
			model: pair[0],
			reported: Array.reduce(pair[1], 0, (total, group) => total + group.values.cost.reported)
		})
	)
	return {
		calls: Array.reduce(models, 0, (total, model) => total + model.calls),
		cost: Array.reduce(models, 0, (total, model) => total + model.cost),
		models,
		reported: Array.reduce(models, 0, (total, model) => total + model.reported)
	}
}
