import {assert, it} from '@effect/vitest'

import {Array} from 'effect'

import {availablePorts, processOwner, unitFailures, workloadName, workloads} from '#services/inventory/lib/utils.ts'
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
	return workloads([item]).length === 1
}

it('uses concise display names without changing service/container identifiers', () => {
	assert.strictEqual(workloadName({...listener, kind: 'service', name: 'deslop-scope.service'}), 'scope')
	assert.strictEqual(workloadName({...listener, kind: 'service', name: 't3code.service'}), 't3code')
	assert.strictEqual(workloadName({...listener, kind: 'container', name: 'deslop-stash-1'}), 'stash')
	assert.strictEqual(
		workloadName({...listener, kind: 'container', name: 'dual-postgres-wt-cc52031fa2a8-i4gwwaeao22pymmk'}),
		'dual-postgres-wt-cc52031-i4gwwae'
	)
	assert.strictEqual(
		workloadName({...listener, kind: 'container', name: 'long-meaningful-application'}),
		'long-meaningful-application'
	)
	assert.strictEqual(workloadName({...listener, kind: 'service', name: 'preview-t3-123.service'}), 'Preview t3-123')
	assert.strictEqual(
		workloadName({...listener, kind: 'service', name: 'preview-t3-16dbb9fe.service'}),
		'Preview t3-16dbb9f'
	)
	assert.strictEqual(
		workloadName({...listener, detail: '@deslop/deploy', kind: 'service', name: 'preview-t3-123.service'}),
		'deploy preview'
	)
})

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

it('keeps app activity and failures without nameless listeners or ordinary system daemons', () => {
	assert.isTrue(important(listener))
	assert.isFalse(important({...listener, process: ''}))
	assert.isFalse(important({...listener, process: undefined}))
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
	const rows = workloads([
		service,
		{...listener, unit: service.name},
		exposure,
		{...listener, id: 'desktop:port:5173', worker: 'desktop'}
	])
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
		const rows = workloads([container, host, exposure])
		assert.lengthOf(rows, 2)
		assert.isEmpty(rows[0]?.exposures ?? [])
		assert.deepStrictEqual(rows[1]?.exposures, [exposure])
	}
	const mapped = workloads([
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
	])
	assert.lengthOf(mapped, 1)
	assert.deepStrictEqual(mapped[0]?.exposures, [exposure])
})

it("counts what a user's service starts in its own app slice, like T3 Code's agents, as that service", () => {
	const manager = '0::/user.slice/user-1000.slice/user@1000.service'
	assert.strictEqual(
		processOwner(
			`${manager}/app.slice/app-t3code.slice/app-t3code-agents.slice/app-t3code-agents-1.slice/t3code-claude-2.scope\n`
		),
		'service:user:t3code.service'
	)
	assert.strictEqual(processOwner(`${manager}/app.slice/t3code.service\n`), 'service:user:t3code.service')
	assert.strictEqual(
		processOwner(`${manager}/app.slice/app-org.chromium.Chromium-1.scope\n`),
		'service:system:user@1000.service'
	)
	assert.strictEqual(processOwner('0::/system.slice/app-other.slice/x.scope\n'), 'service:system:')
})

it('says why a failed service stopped and when, instead of repeating its command', () => {
	const failures = unitFailures(
		Array.join(
			[
				'Result=exit-code\nExecMainCode=1\nExecMainStatus=130\nId=e2e-auth.service\nStateChangeTimestamp=@1793639294',
				'Result=signal\nExecMainStatus=9\nId=killed.service\nStateChangeTimestamp=',
				'Result=oom-kill\nExecMainStatus=0\nId=heavy.service\nStateChangeTimestamp=@1',
				'Result=exit-code\nExecMainCode=1\nExecMainStatus=1\nId=crash.service\nStateChangeTimestamp=@2',
				'Result=exit-code\nExecMainCode=0\nExecMainStatus=0\nId=prestart.service\nStateChangeTimestamp=@3'
			],
			'\n\n'
		)
	)
	assert.deepStrictEqual(failures['e2e-auth.service'], {at: 1_793_639_294_000, reason: 'Exited with code 130 (SIGINT)'})
	assert.deepStrictEqual(failures['killed.service'], {reason: 'Killed by SIGKILL'})
	assert.strictEqual(failures['heavy.service']?.reason, 'Killed for running out of memory')
	assert.strictEqual(failures['crash.service']?.reason, 'Exited with code 1')
	assert.strictEqual(failures['prestart.service']?.reason, 'Failed before starting')
	assert.deepStrictEqual(unitFailures(''), {})
})
