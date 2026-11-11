import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {impactGroups} from '#routes/(home)/-rows.ts'
import {workloads} from '#services/inventory/lib/utils.ts'
import type {InventoryItem} from '#services/inventory/schema.ts'
import type {MachineHistory, Sample} from '#services/metrics/schema.ts'

const GIB = 1024 ** 3

function item(name: string, state = 'active · running', detail = '') {
	return {
		detail,
		id: `service:user:${name}`,
		kind: 'service',
		name,
		scope: 'user',
		state,
		url: '',
		worker: 'dev'
	} satisfies InventoryItem
}

function row(name: string, state?: string, detail?: string) {
	return Option.getOrThrow(Array.head(workloads([item(name, state, detail)])))
}

function sample(time: number, apps: Sample['apps']) {
	return {apps, cpu: 50, disks: [], memoryTotal: 10 * GIB, memoryUsed: 6 * GIB, time} satisfies Sample
}

function machine(samples: Sample[]) {
	return {
		error: '',
		samples,
		stale: false,
		time: Option.getOrThrow(Option.map(Array.last(samples), last => last.time)),
		worker: 'desktop'
	} satisfies MachineHistory
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
