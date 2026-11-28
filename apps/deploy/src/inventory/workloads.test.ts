import {assert, it} from '@effect/vitest'

import {Array, DateTime, Effect, Option, Order, Schema, pipe} from 'effect'

import {ExposureName, InventoryItem, ItemId, Process, UnitId} from './contract.ts'
import type {ServiceScope} from './contract.ts'
import {jobRequest} from './server.ts'
import {availablePorts, portOwner, processOwner, processTrackUsage, processTree, workloads} from './workloads.ts'
import type {ProcessNode} from './workloads.ts'

import {DeployError} from '#machine/contract.ts'

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

function label(name: string, detail = '') {
	return {detail, name}
}

function pids(nodes: readonly ProcessNode[]): number[] {
	return Array.flatMap(nodes, node => [...Array.filter([node.pid], pid => pid > 0), ...pids(node.children)])
}

function reads(parent: number) {
	return Schema.decodeSync(Schema.Array(Process))([
		{label: label('server'), memory: 5, name: 'server', parent: 0, pid: parent},
		{label: label('worker'), memory: 3, name: 'worker', parent, pid: parent + 1},
		{label: label('worker'), memory: 2, name: 'worker', parent, pid: parent + 2}
	])
}

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

it('nests children heaviest first and keeps every process exactly once', () => {
	const tree = processTree(
		Schema.decodeSync(Schema.Array(Process))([
			{cpu: 1, label: label('node'), memory: 100, name: 'node', parent: 0, pid: 1},
			{cpu: 4, label: label('claude', 'opus'), memory: 300, name: 'claude', parent: 1, pid: 2},
			{cpu: 0, label: label('chrome'), memory: 200, name: 'chrome', parent: 1, pid: 3},
			{cpu: 0, label: label('chrome', 'gpu'), memory: 50, name: 'chrome', parent: 3, pid: 4}
		])
	)
	assert.lengthOf(tree, 1)
	assert.strictEqual(tree[0]?.memory, 650)
	assert.deepStrictEqual(tree[0]?.cpu, Option.some(5))
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => node.label.name),
		['claude', 'chrome']
	)
	assert.deepStrictEqual(Array.sort(pids(tree), Order.Number), [1, 2, 3, 4])
})

it('folds a child with its parent’s label, keeping its usage and descendants', () => {
	const tree = processTree(
		Schema.decodeSync(Schema.Array(Process))([
			{cpu: 1, label: label('claude', 'opus'), memory: 10, name: 'sh', parent: 0, pid: 1},
			{cpu: 2, label: label('claude', 'opus'), memory: 20, name: 'claude', parent: 1, pid: 2},
			{cpu: 3, label: label('tool'), memory: 30, name: 'tool', parent: 2, pid: 3}
		])
	)
	assert.strictEqual(tree[0]?.pid, 1)
	assert.deepStrictEqual(tree[0]?.label, label('claude', 'opus'))
	assert.strictEqual(tree[0]?.memory, 60)
	assert.deepStrictEqual(tree[0]?.cpu, Option.some(6))
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => node.label.name),
		['tool']
	)
	assert.deepStrictEqual(Array.sort(pids(tree), Order.Number), [1, 3])
})

it('mutes processes that barely use anything without folding them away', () => {
	const tree = processTree(
		Schema.decodeSync(Schema.Array(Process))([
			{cpu: 2, label: label('postgres'), memory: 1000, name: 'postgres', parent: 0, pid: 1},
			{cpu: 0, label: label('writer'), memory: 300, name: 'writer', parent: 1, pid: 2},
			...Array.makeBy(3, index => ({
				cpu: 0,
				label: label('worker'),
				memory: 1,
				name: 'worker',
				parent: 1,
				pid: index + 3
			}))
		])
	)
	assert.deepStrictEqual(
		Array.map(tree[0]?.children ?? [], node => ({name: node.label.name, small: node.small})),
		[
			{name: 'writer', small: false},
			{name: 'worker', small: true},
			{name: 'worker', small: true},
			{name: 'worker', small: true}
		]
	)
})

it('keeps unknown CPU unknown and terminates cyclic source relationships', () => {
	const tree = processTree(
		Schema.decodeSync(Schema.Array(Process))([
			{label: label('node'), memory: 1, name: 'node', parent: 2, pid: 1},
			{label: label('node', 'worker'), memory: 2, name: 'node', parent: 1, pid: 2}
		])
	)
	assert.lengthOf(tree, 1)
	assert.deepStrictEqual(tree[0]?.cpu, Option.none())
	assert.strictEqual(tree[0]?.memory, 3)
})

it('tracks process roles across a restart without inventing identities for matching siblings', () => {
	const before = pipe(reads(1), processTree, processTrackUsage)
	assert.deepStrictEqual(pipe(reads(44), processTree, processTrackUsage), before)
	assert.lengthOf(before, 2)
	assert.deepStrictEqual(
		pipe(
			before,
			Array.findFirst(track => track.label.name === 'worker'),
			Option.map(track => track.memory)
		),
		Option.some(5)
	)
})
