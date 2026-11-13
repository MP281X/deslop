import {assert, it} from '@effect/vitest'

import {Array, Option, Schema, Struct} from 'effect'

import {
	availablePorts,
	processOwner,
	sourceBelongsToWorker,
	workloadName,
	workloads
} from '#services/inventory/lib/utils.ts'
import {InventoryItem, WorkerId, WorkerList} from '#services/inventory/schema.ts'

const LISTENER = {
	active: false,
	address: '127.0.0.1:5173',
	detail: '127.0.0.1:5173 · node',
	health: 'quiet',
	http: true,
	id: 'dev:port:5173',
	kind: 'port',
	name: '127.0.0.1:5173',
	port: 5173,
	process: 'fixture',
	protocol: 'tcp',
	running: false,
	state: 'LISTEN',
	url: '',
	worker: 'dev'
} satisfies typeof InventoryItem.Encoded

it('matches a worker’s bare or prefixed source and no other worker’s', () => {
	assert.isTrue(sourceBelongsToWorker({name: 'desktop'}, WorkerId.make('desktop')))
	assert.isFalse(sourceBelongsToWorker({name: 'desktop'}, WorkerId.make('dev')))
	assert.isTrue(sourceBelongsToWorker({name: 'desktop · Tailscale'}, WorkerId.make('desktop')))
	assert.isFalse(sourceBelongsToWorker({name: 'desktop · Tailscale'}, WorkerId.make('dev')))
	assert.isFalse(sourceBelongsToWorker({name: 'Docker'}, WorkerId.make('dev')))
})

it("counts what a user's service starts in its own app slice, like T3 Code's agents, as that service", () => {
	const manager = '0::/user.slice/user-1000.slice/user@1000.service'
	assert.strictEqual(
		Option.getOrThrow(
			processOwner(
				`${manager}/app.slice/app-t3code.slice/app-t3code-agents.slice/app-t3code-agents-1.slice/t3code-claude-2.scope\n`
			)
		),
		'service:user:t3code.service'
	)
	assert.strictEqual(
		Option.getOrThrow(processOwner(`${manager}/app.slice/t3code.service\n`)),
		'service:user:t3code.service'
	)
	assert.strictEqual(
		Option.getOrThrow(processOwner(`${manager}/app.slice/app-org.chromium.Chromium-1.scope\n`)),
		'service:system:user@1000.service'
	)
	assert.isTrue(Option.isNone(processOwner('0::/system.slice/app-other.slice/x.scope\n')))
})

it('validates worker origins when parsing configuration', () => {
	for (const origin of ['https://desktop.example.ts.net:5102', 'http://127.0.0.1:5102']) {
		assert.isTrue(Schema.is(WorkerList)(`desktop=${origin}`))
	}
	for (const origin of [
		'http://desktop.example.ts.net:5102',
		'https://desktop.example.ts.net/path',
		'https://user:pass@desktop.example.ts.net',
		'https://desktop.example.ts.net#fragment'
	]) {
		assert.isFalse(Schema.is(WorkerList)(`desktop=${origin}`))
	}
})

function important(item: typeof InventoryItem.Encoded) {
	return workloads(Schema.decodeSync(Schema.Array(InventoryItem))([item])).length === 1
}

it('uses concise display names without changing service/container identifiers', () => {
	assert.strictEqual(
		workloadName(Schema.decodeSync(InventoryItem)({...LISTENER, kind: 'service', name: 'deslop-scope.service'})),
		'scope'
	)
	assert.strictEqual(
		workloadName(Schema.decodeSync(InventoryItem)({...LISTENER, kind: 'service', name: 't3code.service'})),
		't3code'
	)
	assert.strictEqual(
		workloadName(Schema.decodeSync(InventoryItem)({...LISTENER, kind: 'container', name: 'deslop-stash-1'})),
		'stash'
	)
	assert.strictEqual(
		workloadName(
			Schema.decodeSync(InventoryItem)({
				...LISTENER,
				kind: 'container',
				name: 'dual-postgres-wt-cc52031fa2a8-i4gwwaeao22pymmk'
			})
		),
		'dual-postgres-wt-cc52031-i4gwwae'
	)
	assert.strictEqual(
		workloadName(
			Schema.decodeSync(InventoryItem)({...LISTENER, kind: 'container', name: 'long-meaningful-application'})
		),
		'long-meaningful-application'
	)
	assert.strictEqual(
		workloadName(Schema.decodeSync(InventoryItem)({...LISTENER, kind: 'service', name: 'preview-t3-123.service'})),
		'Preview t3-123'
	)
	assert.strictEqual(
		workloadName(Schema.decodeSync(InventoryItem)({...LISTENER, kind: 'service', name: 'preview-t3-16dbb9fe.service'})),
		'Preview t3-16dbb9f'
	)
	assert.strictEqual(
		workloadName(
			Schema.decodeSync(InventoryItem)({
				...LISTENER,
				detail: '@deslop/deploy',
				kind: 'service',
				name: 'preview-t3-123.service'
			})
		),
		'deploy preview'
	)
})

it('keeps application listeners but excludes non-loopback, UDP and privileged targets from publishing', () => {
	assert.lengthOf(availablePorts(workloads(Schema.decodeSync(Schema.Array(InventoryItem))([LISTENER]))), 1)
	for (const change of [
		{protocol: 'udp' as const},
		{address: '100.68.201.107:5173'},
		{address: '[::1]:5173'},
		{port: 443}
	]) {
		assert.isEmpty(
			availablePorts(workloads(Schema.decodeSync(Schema.Array(InventoryItem))([{...LISTENER, ...change}])))
		)
	}
	assert.lengthOf(
		availablePorts(workloads(Schema.decodeSync(Schema.Array(InventoryItem))([{...LISTENER, address: '0.0.0.0:5173'}]))),
		1
	)
})

it('keeps app activity and failures without nameless listeners or ordinary system daemons', () => {
	assert.isTrue(important(LISTENER))
	assert.isFalse(important({...LISTENER, process: ''}))
	assert.isFalse(important(Struct.omit(LISTENER, ['process'])))
	assert.isFalse(important({...LISTENER, process: 'ssh'}))
	assert.isFalse(important({...LISTENER, process: 'cloudflared'}))
	for (const name of ['deslop-scope.service', 'preview-example.service', 't3code.service']) {
		assert.isTrue(important({...LISTENER, kind: 'service', name, scope: 'user', state: 'inactive · dead'}))
	}
	assert.isFalse(
		important({...LISTENER, kind: 'service', name: 'dbus.service', scope: 'user', state: 'active · running'})
	)
	assert.isFalse(
		important({
			...LISTENER,
			kind: 'service',
			name: 'systemd-journald.service',
			scope: 'system',
			state: 'active · running'
		})
	)
	assert.isTrue(
		important({
			...LISTENER,
			health: 'error',
			kind: 'service',
			name: 'backup.service',
			scope: 'system',
			state: 'failed · failed'
		})
	)
	assert.isTrue(important({...LISTENER, active: true, kind: 'container', state: 'running'}))
	assert.isFalse(important({...LISTENER, detail: 'Exited (0)', kind: 'container', state: 'exited'}))
	assert.isTrue(important({...LISTENER, kind: 'exposure', owned: true}))
	assert.isFalse(important({...LISTENER, kind: 'exposure', owned: false}))
	assert.isTrue(important({...LISTENER, kind: 'exposure', owned: false, publicAccess: true}))
})

it('deduplicates listening ports per worker without losing identical port numbers on other workers', () => {
	assert.strictEqual(
		availablePorts(
			workloads(
				Schema.decodeSync(Schema.Array(InventoryItem))([
					LISTENER,
					{...LISTENER, address: '0.0.0.0:5173', id: 'duplicate'},
					{...LISTENER, id: 'remote', worker: 'desktop'}
				])
			)
		).length,
		2
	)
})

it('offers only unexposed frontends, across both owned and observed routes and without crossing workers', () => {
	const service = {
		...LISTENER,
		id: 'service',
		kind: 'service' as const,
		name: 'deslop-fixture.service',
		scope: 'user' as const,
		state: 'active · running'
	}
	const endpoint = {...LISTENER, ui: true, unit: service.name}
	const remote = {...endpoint, id: 'remote', worker: 'desktop'}
	assert.lengthOf(
		availablePorts(workloads(Schema.decodeSync(Schema.Array(InventoryItem))([service, endpoint, remote]))),
		2
	)
	for (const owned of [false, true]) {
		const exposed = {
			...LISTENER,
			id: 'exposed',
			kind: 'exposure' as const,
			owned,
			url: 'https://dev.tailnet.ts.net:5173/'
		}
		assert.deepStrictEqual(
			Array.map(
				availablePorts(workloads(Schema.decodeSync(Schema.Array(InventoryItem))([service, endpoint, remote, exposed]))),
				item => item.worker
			),
			['desktop']
		)
	}
	assert.isEmpty(
		availablePorts(
			workloads(
				Schema.decodeSync(Schema.Array(InventoryItem))([{...service, links: ['https://fixture.example.com']}, endpoint])
			)
		)
	)
	assert.isEmpty(
		availablePorts(workloads(Schema.decodeSync(Schema.Array(InventoryItem))([service, {...endpoint, http: false}])))
	)
})

it('puts service listeners and their tailnet URLs on one workload without mixing machines', () => {
	const service = {
		...LISTENER,
		id: 'dev:user:app',
		kind: 'service' as const,
		name: 'deslop-fixture.service',
		scope: 'user' as const,
		state: 'active · running'
	}
	const exposure = {
		...LISTENER,
		id: 'dev:exposure',
		kind: 'exposure' as const,
		owned: true,
		url: 'https://dev.tailnet.ts.net:5173/'
	}
	const rows = workloads(
		Schema.decodeSync(Schema.Array(InventoryItem))([
			service,
			{...LISTENER, unit: service.name},
			exposure,
			{...LISTENER, id: 'desktop:port:5173', worker: 'desktop'}
		])
	)
	assert.lengthOf(rows, 2)
	assert.strictEqual(rows[0]?.item.id, service.id)
	assert.lengthOf(rows[0]?.listeners ?? [], 1)
	assert.deepStrictEqual(Schema.encodeSync(Schema.Array(InventoryItem))(rows[0]?.exposures ?? []), [exposure])
	assert.isEmpty(rows[1]?.exposures ?? [])
})

it('keeps internal container namespaces, different host addresses and UDP separate from a host HTTP endpoint', () => {
	const host = {...LISTENER, address: '127.0.0.1:5000', id: 'host', port: 5000}
	const exposure = {
		...host,
		id: 'owned',
		kind: 'exposure' as const,
		owned: true,
		url: 'https://dev.tailnet.ts.net:5000/'
	}
	for (const binding of [
		{address: 'container', port: 5000, protocol: 'tcp' as const},
		{address: '100.68.201.107:5000', port: 5000, protocol: 'tcp' as const},
		{address: '127.0.0.1:5000', port: 5000, protocol: 'udp' as const}
	]) {
		const container = {
			...LISTENER,
			active: true,
			bindings: [binding],
			id: 'container',
			kind: 'container' as const,
			name: 'web',
			state: 'running'
		}
		const rows = workloads(Schema.decodeSync(Schema.Array(InventoryItem))([container, host, exposure]))
		assert.lengthOf(rows, 2)
		assert.isEmpty(rows[0]?.exposures ?? [])
		assert.deepStrictEqual(Schema.encodeSync(Schema.Array(InventoryItem))(rows[1]?.exposures ?? []), [exposure])
	}
	const mapped = workloads(
		Schema.decodeSync(Schema.Array(InventoryItem))([
			{
				...LISTENER,
				active: true,
				bindings: [{address: '0.0.0.0:5000', port: 5000, protocol: 'tcp'}],
				id: 'container',
				kind: 'container',
				name: 'web',
				state: 'running'
			},
			host,
			exposure
		])
	)
	assert.lengthOf(mapped, 1)
	assert.deepStrictEqual(Schema.encodeSync(Schema.Array(InventoryItem))(mapped[0]?.exposures ?? []), [exposure])
})
