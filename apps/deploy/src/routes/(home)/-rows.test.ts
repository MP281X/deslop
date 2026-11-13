import {assert, it} from '@effect/vitest'

import {Array, Boolean, DateTime, Duration, Option, Schema} from 'effect'

import {impactGroups} from '#routes/(home)/-rows.ts'
import {workloads} from '#services/inventory/lib/utils.ts'
import {InventoryItem, WorkerId} from '#services/inventory/schema.ts'
import type {Sample} from '#services/metrics/schema.ts'
import {AppSample} from '#services/metrics/schema.ts'

const GIB = 1024 ** 3

function item(name: string, state = 'active · running', detail = '') {
	return Schema.decodeSync(InventoryItem)({
		active: true,
		detail,
		health: Boolean.match(state === 'failed', {onFalse: () => 'quiet' as const, onTrue: () => 'error' as const}),
		id: `service:user:${name}`,
		kind: 'service',
		name,
		running: state !== 'failed',
		scope: 'user',
		state,
		url: '',
		worker: 'dev'
	})
}

function row(name: string, state?: string, detail?: string) {
	return Option.getOrThrow(Array.head(workloads([item(name, state, detail)])))
}

function sample(time: number, apps: readonly (typeof AppSample.Encoded)[]) {
	return {
		apps: Option.some(Schema.decodeSync(Schema.Array(AppSample))(apps)),
		cpu: Option.some(50),
		memoryTotal: 10 * GIB,
		memoryUsed: 6 * GIB,
		since: DateTime.makeUnsafe(time),
		step: Duration.millis(1000),
		storageUsed: Option.none(),
		time: DateTime.makeUnsafe(time)
	} satisfies Sample
}

function machine(samples: Sample[]) {
	return {
		disks: [],
		error: Option.none(),
		load: [],
		samples,
		stale: false,
		time: Option.getOrThrow(Option.map(Array.last(samples), last => last.time)),
		worker: WorkerId.make('desktop')
	}
}

it('puts healthy low-impact apps under their own group and keeps failures and large apps up', () => {
	const groups = impactGroups(
		[
			row('t3code.service'),
			row('minecraft.service'),
			row('deslop-stash.service', 'failed', 'exit code 1'),
			row('deslop-scope.service'),
			row('deslop-gateway.service')
		],
		machine([
			sample(60_000, [
				{cpu: 0, id: 'service:user:minecraft.service', memory: 1024},
				{cpu: 0, id: 'service:user:deslop-stash.service', memory: 1024},
				{cpu: 0, id: 'service:user:deslop-scope.service', memory: 2 * GIB},
				{cpu: 0, id: 'service:user:t3code.service', memory: 3 * GIB}
			])
		])
	)
	assert.deepStrictEqual(
		Array.map(groups.high, entry => entry.item.name),
		['t3code.service', 'deslop-stash.service', 'deslop-scope.service', 'deslop-gateway.service']
	)
	assert.deepStrictEqual(
		Array.map(groups.low, entry => entry.item.name),
		['minecraft.service']
	)
})

it('has no low group without history and no high group when only low-impact apps exist', () => {
	const small = row('minecraft.service')
	const history = machine([sample(60_000, [{cpu: 0, id: 'service:user:minecraft.service', memory: 1024}])])
	assert.deepStrictEqual(impactGroups([small]), {high: [small], low: []})
	assert.deepStrictEqual(impactGroups([small], history), {high: [], low: [small]})
})
