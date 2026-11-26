import {assert, it} from '@effect/vitest'

import {Array, DateTime, Effect, Option} from 'effect'

import {DeployError, ExposureName, InventoryItem, ItemId, UnitId, availablePorts, workloads} from '#contracts'
import type {ServiceScope} from '#contracts'

import {jobRequest, portOwner, processOwner} from '#server/inventory/lib/inventory.ts'

const LISTENER = InventoryItem.make({
	address: Option.some('127.0.0.1:5173'),
	detail: '',
	http: Option.some(true),
	id: ItemId.make('port:tcp:127.0.0.1:5173'),
	kind: 'port',
	name: '127.0.0.1:5173',
	port: Option.some(5173),
	process: Option.some('app'),
	protocol: Option.some('tcp'),
	state: 'LISTEN',
	url: Option.none()
})
const SERVICE = InventoryItem.make({
	active: true,
	detail: '',
	id: ItemId.make('user:app.service'),
	kind: 'service',
	name: UnitId.make('app.service'),
	scope: Option.some('user'),
	state: 'active',
	url: Option.none()
})
const EXPOSURE = InventoryItem.make({
	detail: '',
	id: ItemId.make('tailscale:exposure'),
	kind: 'exposure',
	name: ExposureName.make('app'),
	owned: Option.some(true),
	port: Option.some(5173),
	state: 'active',
	url: Option.some('https://dev.tailnet.ts.net:5173/')
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

it('deduplicates endpoints', () => {
	assert.lengthOf(
		availablePorts(
			workloads([LISTENER, {...LISTENER, address: Option.some('0.0.0.0:5173'), id: ItemId.make('duplicate')}])
		),
		1
	)
})

it('offers only unexposed frontends', () => {
	const endpoint = {
		...LISTENER,
		scope: Option.some('user' as const),
		ui: Option.some(true),
		unit: Option.some(UnitId.make('app.service'))
	}
	assert.isEmpty(availablePorts(workloads([SERVICE, endpoint, EXPOSURE])))
	assert.deepStrictEqual(
		Array.map(availablePorts(workloads([SERVICE, endpoint])), item => item.id),
		[endpoint.id]
	)
})

it('joins a service with its listener and exposure', () => {
	assert.deepStrictEqual(
		Array.map(
			workloads([
				SERVICE,
				{...LISTENER, scope: Option.some('user' as const), unit: Option.some(UnitId.make('app.service'))},
				EXPOSURE
			]),
			row => [
				row.item.id,
				Array.map(row.listeners, listener => listener.id),
				Array.map(row.exposures, exposure => exposure.id)
			]
		),
		[[SERVICE.id, [LISTENER.id], [EXPOSURE.id]]]
	)
})

// The exposure ids shown on the row of a service with its listener.
function joined(...exposures: InventoryItem[]) {
	return Array.map(
		workloads([
			SERVICE,
			{...LISTENER, scope: Option.some('user' as const), unit: Option.some(UnitId.make('app.service'))},
			...exposures
		]),
		row => Array.map(row.exposures, exposure => exposure.id)
	)
}

it('shows a public mapping of an owned private address beside the owned exposure', () => {
	const owned = {...EXPOSURE, publicAccess: Option.some(false)}
	const observed = {
		...EXPOSURE,
		id: ItemId.make('tailscale:observed'),
		owned: Option.some(false),
		publicAccess: Option.some(true),
		state: 'observed'
	}
	assert.deepStrictEqual(joined(owned, observed), [[owned.id, observed.id]])
	assert.deepStrictEqual(joined(owned, {...observed, publicAccess: Option.some(false)}), [[owned.id]])
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
		url: Option.none()
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

// A service of one name under a manager.
function service(name: string, scope: ServiceScope) {
	return InventoryItem.make({
		active: true,
		detail: '',
		id: ItemId.make(`${scope}:${name}`),
		kind: 'service',
		name: UnitId.make(name),
		scope: Option.some(scope),
		state: 'active',
		url: Option.none()
	})
}

it('keeps a user and a system unit of one name apart', () => {
	const user = service('deslop-app.service', 'user')
	const system = service('deslop-app.service', 'system')
	assert.deepStrictEqual(
		Array.map(
			workloads([
				user,
				system,
				{...LISTENER, scope: Option.some('user' as const), unit: Option.some(UnitId.make('deslop-app.service'))}
			]),
			row => [row.item.id, Array.map(row.listeners, item => item.id)]
		),
		[
			[user.id, [LISTENER.id]],
			[system.id, []]
		]
	)
})

it('lists an owned exposure on its own when the service it reaches is hidden', () => {
	assert.deepStrictEqual(
		Array.map(
			workloads([
				service('background.service', 'system'),
				{...LISTENER, scope: Option.some('system' as const), unit: Option.some(UnitId.make('background.service'))},
				EXPOSURE
			]),
			row => row.item.id
		),
		[EXPOSURE.id]
	)
})

it('names who a loopback proxy to a port reaches: a publishing container first, else each listener', () => {
	const unit = {...LISTENER, scope: Option.some<ServiceScope>('user'), unit: Option.some(UnitId.make('app.service'))}
	const container = InventoryItem.make({
		bindings: Option.some([{address: '0.0.0.0:5173', port: 5173, protocol: 'tcp' as const}]),
		detail: '',
		id: ItemId.make('docker:1'),
		kind: 'container',
		name: 'grafana',
		state: 'running',
		url: Option.none()
	})
	assert.deepStrictEqual(portOwner([unit], 5173), Option.some('user:app.service'))
	assert.deepStrictEqual(portOwner([LISTENER], 5173), Option.some('process:app'))
	assert.deepStrictEqual(portOwner([unit, container], 5173), Option.some('container:grafana'))
	assert.deepStrictEqual(portOwner([{...unit, address: Option.some('[::1]:5173')}], 5173), Option.none())
	assert.deepStrictEqual(portOwner([unit], 5174), Option.none())
})

it.effect(
	'starts the one job its id names when a user and a system timer share a name',
	Effect.fnUntraced(function* () {
		const snapshot = {
			items: Array.map(['user', 'system'] as const, scope => ({
				...service('deslop-cleanup.service', scope),
				scheduled: Option.some(true)
			})),
			sources: [],
			time: DateTime.makeUnsafe(0)
		}
		assert.deepStrictEqual(yield* jobRequest(snapshot, {id: ItemId.make('system:deslop-cleanup.service')}), {
			name: UnitId.make('deslop-cleanup.service'),
			scope: 'system'
		})
		assert.instanceOf(
			yield* Effect.flip(jobRequest(snapshot, {id: ItemId.make('deslop-cleanup.service')})),
			DeployError
		)
	})
)
