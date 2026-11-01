import {assert, it} from '@effect/vitest'

import {important, ports} from '#services/inventory/lib/utils.ts'
import {InventoryItem} from '#services/inventory/schema.ts'

const listener = InventoryItem.make({
	address: '127.0.0.1:5173',
	detail: '127.0.0.1:5173 · node',
	id: 'dev:port:5173',
	kind: 'port',
	name: '127.0.0.1:5173',
	port: 5173,
	process: 'node',
	protocol: 'tcp',
	state: 'LISTEN',
	url: '',
	worker: 'dev'
})

it('keeps application listeners but excludes non-loopback, UDP, stale and privileged targets from publishing', () => {
	assert.lengthOf(ports([listener]), 1)
	for (const change of [
		{protocol: 'udp' as const},
		{address: '100.68.201.107:5173'},
		{address: '[::1]:5173'},
		{state: 'stale · LISTEN'},
		{port: 443}
	]) {
		assert.isEmpty(ports([{...listener, ...change}]))
	}
	assert.lengthOf(ports([{...listener, address: '0.0.0.0:5173'}]), 1)
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
		ports([
			listener,
			{...listener, address: '0.0.0.0:5173', id: 'duplicate'},
			{...listener, id: 'remote', worker: 'desktop'}
		]).length,
		2
	)
})
