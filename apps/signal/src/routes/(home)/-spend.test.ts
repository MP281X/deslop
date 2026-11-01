import {assert, it} from '@effect/vitest'

import {spendOf} from './-spend.ts'

import type {UsageLedger} from '#services/game/schema.ts'

it('sums reported model spend, separates environments and does not turn missing cost into a reported zero', () => {
	const group: UsageLedger['groups'][string] = {
		calls: 3,
		kind: 'strategy',
		mode: 'development',
		model: 'model-a',
		values: {
			cached: {reported: 0, total: 0},
			cost: {reported: 2, total: 0.03},
			input: {reported: 2, total: 100},
			output: {reported: 2, total: 20},
			written: {reported: 0, total: 0}
		}
	}
	const ledger: UsageLedger = {
		groups: {
			compaction: {...group, calls: 1, kind: 'compaction', values: {...group.values, cost: {reported: 1, total: 0.01}}},
			first: group,
			production: {...group, mode: 'production'},
			unreported: {...group, calls: 1, model: 'model-b', values: {...group.values, cost: {reported: 0, total: 0}}}
		}
	}
	const development = spendOf(ledger, 'development')
	assert.closeTo(development.cost, 0.04, 0.000001)
	assert.strictEqual(development.calls, 5)
	assert.strictEqual(development.reported, 3)
	assert.strictEqual(development.models[0]?.model, 'model-a')
	assert.strictEqual(development.models[1]?.reported, 0)
	assert.strictEqual(spendOf(ledger, 'production').cost, 0.03)
	assert.deepStrictEqual(spendOf({groups: {}}, 'development'), {calls: 0, cost: 0, models: [], reported: 0})
})
