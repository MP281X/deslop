import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {availablePorts, workloads} from '#services/inventory/lib/utils.ts'
import {InventoryItem} from '#services/inventory/schema.ts'

const listener = InventoryItem.make({
	address: '127.0.0.1:5173',
	detail: '127.0.0.1:5173 · node',
	http: true,
	id: 'dev:port:5173',
	kind: 'port',
	name: '127.0.0.1:5173',
	port: 5173,
	process: 'fixture',
	protocol: 'tcp',
	state: 'LISTEN',
	url: '',
	worker: 'dev'
})

function important(item: InventoryItem) {
	return workloads([item], false).length === 1
}

it('keeps application listeners but excludes non-loopback, UDP, stale and privileged targets from publishing', () => {
	assert.lengthOf(availablePorts([listener]), 1)
	for (const change of [
		{protocol: 'udp' as const},
		{address: '100.68.201.107:5173'},
		{address: '[::1]:5173'},
		{state: 'stale · LISTEN'},
		{port: 443}
	]) {
		assert.isEmpty(availablePorts([{...listener, ...change}]))
	}
	assert.lengthOf(availablePorts([{...listener, address: '0.0.0.0:5173'}]), 1)
})

it('defaults to app activity and failures without hiding the complete inventory from other views', () => {
	assert.isTrue(important(listener))
	assert.isTrue(important({...listener, state: 'stale · LISTEN'}))
	assert.isFalse(important({...listener, process: 'ssh'}))
	assert.isFalse(important({...listener, process: 'cloudflared'}))
	for (const name of ['deslop-scope.service', 'preview-example.service', 't3code.service']) {
		assert.isTrue(important({...listener, kind: 'service', name, scope: 'user', state: 'inactive · dead'}))
	}
	assert.isFalse(
		important({...listener, kind: 'service', name: 'dbus.service', scope: 'user', state: 'active · running'})
	)
	assert.isFalse(
		important({
			...listener,
			kind: 'service',
			name: 'systemd-journald.service',
			scope: 'system',
			state: 'active · running'
		})
	)
	assert.isTrue(
		important({...listener, kind: 'service', name: 'backup.service', scope: 'system', state: 'failed · failed'})
	)
	assert.isTrue(important({...listener, kind: 'container', state: 'stale · running'}))
	assert.isFalse(important({...listener, detail: 'Exited (0)', kind: 'container', state: 'exited'}))
	assert.isTrue(important({...listener, kind: 'exposure', owned: true}))
	assert.isFalse(important({...listener, kind: 'exposure', owned: false}))
	assert.isTrue(important({...listener, kind: 'exposure', owned: false, publicAccess: true}))
})

it('deduplicates listening ports per worker without losing identical port numbers on other workers', () => {
	assert.strictEqual(
		availablePorts([
			listener,
			{...listener, address: '0.0.0.0:5173', id: 'duplicate'},
			{...listener, id: 'remote', worker: 'desktop'}
		]).length,
		2
	)
})

it('offers only unexposed frontends, across both owned and observed routes and without crossing workers', () => {
	const service = {
		...listener,
		id: 'service',
		kind: 'service' as const,
		name: 'deslop-fixture.service',
		scope: 'user' as const,
		state: 'active · running'
	}
	const endpoint = {...listener, ui: true, unit: service.name}
	const remote = {...endpoint, id: 'remote', worker: 'desktop'}
	assert.lengthOf(availablePorts([service, endpoint, remote]), 2)
	for (const owned of [false, true]) {
		const exposed = {
			...listener,
			id: 'exposed',
			kind: 'exposure' as const,
			owned,
			url: 'https://dev.tailnet.ts.net:5173/'
		}
		assert.deepStrictEqual(
			Array.map(availablePorts([service, endpoint, remote, exposed]), item => item.worker),
			['desktop']
		)
	}
	assert.isEmpty(availablePorts([{...service, links: ['https://fixture.example.com']}, endpoint]))
	assert.isEmpty(availablePorts([service, {...endpoint, http: false}]))
})

it('puts service listeners and their tailnet URLs on one workload without mixing machines', () => {
	const service = {
		...listener,
		id: 'dev:user:app',
		kind: 'service' as const,
		name: 'deslop-fixture.service',
		scope: 'user' as const,
		state: 'active · running'
	}
	const exposure = {
		...listener,
		id: 'dev:exposure',
		kind: 'exposure' as const,
		owned: true,
		url: 'https://dev.tailnet.ts.net:5173/'
	}
	const rows = workloads(
		[service, {...listener, unit: service.name}, exposure, {...listener, id: 'desktop:port:5173', worker: 'desktop'}],
		false
	)
	assert.lengthOf(rows, 2)
	assert.strictEqual(rows[0]?.item.id, service.id)
	assert.lengthOf(rows[0]?.listeners ?? [], 1)
	assert.deepStrictEqual(rows[0]?.exposures, [exposure])
	assert.isEmpty(rows[1]?.exposures ?? [])
})

it('keeps internal container namespaces, different host addresses and UDP separate from a host HTTP endpoint', () => {
	const host = {...listener, address: '127.0.0.1:5000', id: 'host', port: 5000}
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
			...listener,
			bindings: [binding],
			id: 'container',
			kind: 'container' as const,
			name: 'web',
			state: 'running'
		}
		const rows = workloads([container, host, exposure], true)
		assert.lengthOf(rows, 2)
		assert.isEmpty(rows[0]?.exposures ?? [])
		assert.deepStrictEqual(rows[1]?.exposures, [exposure])
	}
	const mapped = workloads(
		[
			{
				...listener,
				bindings: [{address: '0.0.0.0:5000', port: 5000, protocol: 'tcp'}],
				id: 'container',
				kind: 'container',
				name: 'web',
				state: 'running'
			},
			host,
			exposure
		],
		true
	)
	assert.lengthOf(mapped, 1)
	assert.deepStrictEqual(mapped[0]?.exposures, [exposure])
})
