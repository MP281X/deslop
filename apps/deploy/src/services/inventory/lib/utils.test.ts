import {assert, it} from '@effect/vitest'

import {Array, Option} from 'effect'

import {availablePorts, processOwner, workloads} from '#services/inventory/lib/utils.ts'
import {ExposureName, InventoryItem, ItemId, UnitId, WorkerId} from '#services/inventory/schema.ts'

const LISTENER = InventoryItem.make({
	address: Option.some('127.0.0.1:5173'),
	detail: '',
	http: Option.some(true),
	id: ItemId.make('dev:port:5173'),
	kind: 'port',
	name: '127.0.0.1:5173',
	port: Option.some(5173),
	process: Option.some('app'),
	protocol: Option.some('tcp'),
	state: 'LISTEN',
	url: Option.none(),
	worker: WorkerId.make('dev')
})
const SERVICE = InventoryItem.make({
	active: true,
	detail: '',
	id: ItemId.make('dev:service'),
	kind: 'service',
	name: UnitId.make('app.service'),
	scope: Option.some('user'),
	state: 'active',
	url: Option.none(),
	worker: WorkerId.make('dev')
})
const EXPOSURE = InventoryItem.make({
	detail: '',
	id: ItemId.make('dev:exposure'),
	kind: 'exposure',
	name: ExposureName.make('app'),
	owned: Option.some(true),
	port: Option.some(5173),
	state: 'active',
	url: Option.some('https://dev.tailnet.ts.net:5173/'),
	worker: WorkerId.make('dev')
})

it('attributes nested agent slices to their owning service', () => {
	assert.deepStrictEqual(
		processOwner(
			'0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-t3code.slice/app-t3code-agents.slice/agent.scope\n'
		),
		Option.some('service:user:t3code.service')
	)
	assert.deepStrictEqual(processOwner('0::/system.slice/scope.service\n'), Option.some('service:system:scope.service'))
})

it('offers only usable local HTTP listeners for publication', () => {
	assert.deepStrictEqual(
		Array.map(availablePorts(workloads([LISTENER])), item => item.id),
		[LISTENER.id]
	)
	assert.isEmpty(
		availablePorts(
			workloads([
				{...LISTENER, protocol: Option.some('udp')},
				{...LISTENER, address: Option.some('100.68.201.107:5173')},
				{...LISTENER, port: Option.some(443)}
			])
		)
	)
})

it('deduplicates endpoints within each worker', () => {
	assert.sameMembers(
		Array.map(
			availablePorts(
				workloads([
					LISTENER,
					{...LISTENER, address: Option.some('0.0.0.0:5173'), id: ItemId.make('duplicate')},
					{...LISTENER, id: ItemId.make('remote'), worker: WorkerId.make('desktop')}
				])
			),
			item => item.worker
		),
		['dev', 'desktop']
	)
})

it('offers only unexposed frontends on each worker', () => {
	const endpoint = {...LISTENER, ui: Option.some(true), unit: Option.some(UnitId.make('app.service'))}
	assert.deepStrictEqual(
		Array.map(
			availablePorts(
				workloads([
					SERVICE,
					endpoint,
					EXPOSURE,
					{...endpoint, id: ItemId.make('remote'), worker: WorkerId.make('desktop')}
				])
			),
			item => item.worker
		),
		['desktop']
	)
})

it('joins a service with its listener and exposure on the same worker', () => {
	assert.deepStrictEqual(
		Array.map(workloads([SERVICE, {...LISTENER, unit: Option.some(UnitId.make('app.service'))}, EXPOSURE]), row => [
			row.item.id,
			Array.map(row.listeners, listener => listener.id),
			Array.map(row.exposures, exposure => exposure.id)
		]),
		[[SERVICE.id, [LISTENER.id], [EXPOSURE.id]]]
	)
})

it('matches published container routes only to host TCP bindings', () => {
	const container = InventoryItem.make({
		active: true,
		bindings: Option.some([{address: '0.0.0.0:5173', port: 5173, protocol: 'tcp'}]),
		detail: '',
		id: ItemId.make('container'),
		kind: 'container',
		name: 'web',
		state: 'running',
		url: Option.none(),
		worker: WorkerId.make('dev')
	})
	assert.deepStrictEqual(
		Array.map(workloads([container, LISTENER, EXPOSURE]), row => [
			row.item.id,
			Array.map(row.exposures, exposure => exposure.id)
		]),
		[[container.id, [EXPOSURE.id]]]
	)
	assert.deepStrictEqual(
		Array.map(
			workloads([
				{...container, bindings: Option.some([{address: 'container', port: 5173, protocol: 'tcp'}])},
				LISTENER,
				EXPOSURE
			]),
			row => Array.map(row.exposures, exposure => exposure.id)
		),
		[[], [EXPOSURE.id]]
	)
})
