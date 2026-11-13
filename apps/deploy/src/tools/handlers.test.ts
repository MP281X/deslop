import {assert, it} from '@effect/vitest'

import {Array, Boolean, DateTime, Effect, Formatter, Layer, Option, Ref, Schema, Stream, String, pipe} from 'effect'

import type {ExposeRequest, HideRequest} from '#services/exposures/schema.ts'
import {Fleet} from '#services/fleet/service.ts'
import {Inventory, Snapshot, type InventoryItem, type Process, type RunRequest} from '#services/inventory/schema.ts'
import {chartWindow} from '#services/metrics/lib/utils.ts'
import {ResourceHistory, type MachineHistory, type Sample} from '#services/metrics/schema.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const GIB = 1024 ** 3
const MIB = 1024 ** 2
const NOW = Date.UTC(2026, 10, 10, 12)

function hex(index: number) {
	return `${String.padStart(12, '0')((index + 1).toString(16))}${String.repeat(52)('0')}`
}

function label(name: string, detail = '') {
	return {detail, name}
}

function process(name: string, pid: number, parent: number, memory: number, cpu: number, detail = '') {
	return {cpu, label: label(name, detail), memory, name, parent, pid} satisfies Process
}

// One user service as production reports it: a full masked command tree against each unit and container.
function appItem(worker: string, index: number) {
	const name = Boolean.match(index === 7, {onFalse: () => `svc-${index}`, onTrue: () => 'minecraft'})
	return {
		detail: `user · fixture service ${index}`,
		id: `${worker}:user:${name}.service`,
		kind: 'service',
		name: `${name}.service`,
		processes: [
			{
				...process(name, 1000 + index * 10, 0, 50 * MIB, 4.567, '--serve'),
				command: ['/usr/bin/node', '--auth-token=hidden', 'server.js']
			},
			process('node', 1001 + index * 10, 1000 + index * 10, 20 * MIB, 0.234, 'server.js')
		],
		scope: 'user',
		state: 'active · running',
		url: '',
		worker
	} satisfies InventoryItem
}

function jobItem(worker: string, index: number) {
	const name = `backup-${index}`
	const failed = index === 0
	return {
		detail: `user · scheduled ${index}`,
		...Boolean.match(failed, {
			onFalse: () => ({}),
			onTrue: () => ({failure: {at: NOW - 3_600_000, reason: 'Exited with code 1'}})
		}),
		id: `${worker}:user:${name}.service`,
		kind: 'service',
		name: `${name}.service`,
		...Boolean.match(failed, {onFalse: () => ({next: NOW + (index + 1) * 60_000}), onTrue: () => ({})}),
		scheduled: true,
		scope: 'user',
		state: Boolean.match(failed, {onFalse: () => 'active · running', onTrue: () => 'failed'}),
		url: '',
		worker
	} satisfies InventoryItem
}

function containerItem(worker: string, index: number) {
	return {
		bindings: [{address: 'container', port: 8000 + index, protocol: 'tcp'}],
		detail: 'Up 5 hours',
		id: `${worker}:docker:${hex(index)}`,
		kind: 'container',
		name: Boolean.match(index === 0, {onFalse: () => `web-${index}`, onTrue: () => 'deslop-stash-1'}),
		state: 'running',
		url: '',
		worker
	} satisfies InventoryItem
}

function listener(worker: string, port: number, options?: {nameless?: boolean; unit?: string; udp?: boolean}) {
	const nameless = options?.nameless === true
	const udp = options?.udp === true
	const protocol = Boolean.match(udp, {onFalse: () => 'tcp' as const, onTrue: () => 'udp' as const})
	return {
		address: `127.0.0.1:${port}`,
		detail: `127.0.0.1:${port} · ${Boolean.match(nameless, {
			onFalse: () => 'node',
			onTrue: () => 'process unavailable'
		})}`,
		http: !nameless && !udp,
		id: `${worker}:port:${protocol}:127.0.0.1:${port}`,
		kind: 'port',
		name: `127.0.0.1:${port}`,
		port,
		process: Boolean.match(nameless, {onFalse: () => 'node', onTrue: () => ''}),
		protocol,
		state: 'listening',
		...Option.match(Option.fromUndefinedOr(options?.unit), {onNone: () => ({}), onSome: unit => ({unit})}),
		url: '',
		worker
	} satisfies InventoryItem
}

function exposureItem(worker: string, index: number, linked: boolean) {
	const port = Boolean.match(linked, {onFalse: () => 5000 + index, onTrue: () => 4000 + index})
	return {
		detail: `tailnet → 127.0.0.1:${port}`,
		id: `${worker}:exposure:svc-${index}`,
		kind: 'exposure',
		name: `svc-${index}`,
		owned: true,
		port,
		publicAccess: index % 3 === 0,
		state: 'configured; check backend',
		url: `https://svc-${index}.example.ts.net`,
		worker
	} satisfies InventoryItem
}

// The inventory one production-sized answer sees: 1,000 peers, 210 services with process trees, 62 containers, 12 jobs, listening ports and 17 exposures.
function fixture() {
	const workers = ['dev', 'desktop']
	const peers = Array.makeBy(1000, index => ({
		detail: `linux · 100.64.${Math.floor(index / 250)}.${index % 250}`,
		hostname: `us-lax-wg-${index}.mullvad.ts.net`,
		id: `${workers[index % 2] ?? 'dev'}:peer:us-lax-wg-${index}.mullvad.ts.net.`,
		kind: 'peer' as const,
		name: `us-lax-wg-${index}`,
		self: index === 0,
		state: 'online',
		url: '',
		worker: workers[index % 2] ?? 'dev'
	}))
	const services = Array.flatMap(workers, worker => Array.makeBy(105, index => appItem(worker, index)))
	const crashed = Array.map(workers, worker => ({
		detail: 'user · crashed fixture',
		failure: {at: NOW - 2 * 3_600_000, reason: 'Exited with code 1'},
		id: `${worker}:user:crash.service`,
		kind: 'service' as const,
		name: 'crash.service',
		scope: 'user' as const,
		state: 'failed',
		url: '',
		worker
	}))
	const jobs = Array.flatMap(workers, worker => Array.makeBy(6, index => jobItem(worker, index)))
	const containers = Array.flatMap(workers, worker => Array.makeBy(31, index => containerItem(worker, index)))
	const noise = Array.flatMap(workers, worker =>
		Array.makeBy(20, index => ({
			detail: 'system · noise',
			id: `${worker}:system:cron-${index}.service`,
			kind: 'service' as const,
			name: `cron-${index}.service`,
			scope: 'system' as const,
			state: 'active · running',
			url: '',
			worker
		}))
	)
	const listeners = Array.flatMap(workers, worker => [
		...Array.makeBy(20, index => listener(worker, 3100 + index, {unit: `svc-${index}.service`})),
		...Array.makeBy(8, index => listener(worker, 4000 + index, {unit: `svc-${index}.service`})),
		...Array.makeBy(50, index => listener(worker, 7000 + index, {nameless: index % 2 === 0})),
		...Array.makeBy(40, index => listener(worker, 7200 + index, {udp: true}))
	])
	const exposures = [
		...Array.makeBy(8, index => exposureItem('dev', index, true)),
		...Array.makeBy(2, index => exposureItem('desktop', index, true)),
		...Array.makeBy(7, index => exposureItem(workers[index % 2] ?? 'dev', index + 10, false))
	]
	return Snapshot.make({
		items: [...peers, ...services, ...crashed, ...jobs, ...containers, ...noise, ...listeners, ...exposures],
		sources: [
			{error: '', name: 'User services'},
			{error: 'docker unavailable', name: 'Docker'},
			{error: 'tailscale timed out', name: 'desktop · Tailscale'}
		],
		time: NOW,
		workers
	})
}

function historyFixture() {
	const workers = ['dev', 'desktop']
	return Snapshot.make({
		items: Array.flatMap(workers, worker => [
			containerItem(worker, 0),
			...Array.makeBy(19, index => appItem(worker, index))
		]),
		sources: [],
		time: NOW,
		workers
	})
}

function machineOf(worker: string, options?: {error?: string; stale?: boolean}) {
	const start = chartWindow(60, NOW).start
	const apps = [
		{cpu: 12.34, id: `container:${String.slice(0, 12)(hex(0))}`, memory: 3 * GIB},
		...Array.makeBy(19, index => ({
			...Boolean.match(index === 0, {onFalse: () => ({cpu: 1.234}), onTrue: () => ({})}),
			id: `service:user:svc-${index}.service`,
			memory: (19 - index) * 256 * MIB
		}))
	]
	const samples = Array.makeBy(
		60,
		index =>
			({
				apps: Option.some(apps),
				cpu: Option.liftPredicate(20 + index / 10, () => index !== 0),
				memoryTotal: 16 * GIB,
				memoryUsed: (6 + index / 10) * GIB,
				since: start + index * 60_000 + 30_000,
				step: 60_000,
				storageUsed: Option.some((200 + index) * GIB),
				time: start + index * 60_000 + 30_000
			}) satisfies Sample
	)
	return {
		disks: [{mount: '/', total: 500 * GIB, used: 250 * GIB}],
		error: options?.error ?? '',
		load: [1.5, 1.2, 0.9],
		samples,
		stale: options?.stale === true,
		time: NOW,
		worker
	} satisfies MachineHistory
}

function fleetOf(overrides: Partial<Parameters<typeof Fleet.of>[0]>) {
	const snapshot = Snapshot.make({items: [], sources: [], time: 0})
	const machine = machineOf('dev')
	return Fleet.of({
		current: () => Effect.succeed([]),
		expose: () => Effect.succeed(''),
		hide: () => Effect.void,
		history: () => Effect.succeed(machine),
		local: Effect.succeed(snapshot),
		metrics: () => Effect.succeed([]),
		run: () => Effect.void,
		snapshot: Effect.succeed(snapshot),
		...overrides
	})
}

// The tool layer is the public seam: handlers and schemas as the agent receives them.
function toolkitFor(fleet: Parameters<typeof Fleet.of>[0]) {
	return Effect.flatMap(Layer.build(pipe(ToolHandlers, Layer.provide(Layer.succeed(Fleet, fleet)))), context =>
		Effect.provideContext(ToolContracts, context)
	)
}

it.effect('answers list_apps with the page’s apps in under 20 KB and no tailnet peer', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const toolkit = yield* toolkitFor(fleetOf({snapshot: Effect.succeed(fixture())}))
			const answer = Option.getOrThrow(
				Array.last(Array.fromIterable(yield* Stream.runCollect(yield* toolkit.handle('list_apps', {}))))
			)
			const text = Formatter.formatJson(answer.encodedResult)
			assert.isBelow(text.length, 20_000)
			assert.notInclude(text, 'mullvad')
			const workers = (yield* Schema.decodeUnknownEffect(Schema.Struct({workers: Inventory}))(answer.encodedResult))
				.workers
			assert.lengthOf(workers, 2)
			const dev = Option.getOrThrow(Array.findFirst(workers, worker => worker.worker === 'dev'))
			assert.notInclude(
				Array.map(dev.apps, app => app.name),
				'cron-0'
			)
			assert.isFalse(Array.some(dev.apps, app => Array.contains(app.ports ?? [], 7000)))
			assert.notInclude(text, ' ago')
			assert.lengthOf(
				Array.flatMap(workers, worker => [...worker.apps, ...(worker.jobs ?? []), ...(worker.exposures ?? [])]),
				30
			)
			assert.isDefined(
				(yield* Schema.decodeUnknownEffect(Schema.Struct({nextCursor: Schema.String}))(answer.encodedResult)).nextCursor
			)
			assert.deepStrictEqual(dev.errors, ['Docker: docker unavailable'])
			assert.strictEqual(
				Option.getOrThrow(Array.findFirst(workers, worker => worker.worker === 'desktop')).errors?.[0],
				'Tailscale: tailscale timed out'
			)
		})
	)
)

it.effect('returns only the matching app with its process tree when list_apps names one', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const toolkit = yield* toolkitFor(fleetOf({snapshot: Effect.succeed(fixture())}))
			const answer = Option.getOrThrow(
				Array.last(Array.fromIterable(yield* Stream.runCollect(yield* toolkit.handle('list_apps', {app: 'minecraft'}))))
			)
			const text = Formatter.formatJson(answer.encodedResult)
			assert.notInclude(text, 'command')
			assert.notInclude(text, 'hidden')
			const workers = (yield* Schema.decodeUnknownEffect(Schema.Struct({workers: Inventory}))(answer.encodedResult))
				.workers
			assert.lengthOf(workers, 2)
			for (const worker of workers) {
				assert.deepStrictEqual(
					Array.map(worker.apps, app => app.name),
					['minecraft']
				)
				const app = Option.getOrThrow(Array.head(worker.apps))
				assert.strictEqual(app.processes?.[0]?.name, 'minecraft')
				assert.strictEqual(app.processes?.[0]?.mib, 70)
				assert.strictEqual(app.processes?.[0]?.cpu, 4.8)
				assert.strictEqual(app.processes?.[0]?.children?.[0]?.name, 'node')
				assert.isUndefined(app.processes?.[0]?.children?.[0]?.children)
			}
		})
	)
)

it.effect('answers read_resource_history for 60 points and two workers in under 6 KB with named containers', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const toolkit = yield* toolkitFor(
				fleetOf({
					metrics: () =>
						Effect.succeed([machineOf('dev'), machineOf('desktop', {error: 'Worker unavailable', stale: true})]),
					snapshot: Effect.succeed(historyFixture())
				})
			)
			const answer = Option.getOrThrow(
				Array.last(
					Array.fromIterable(
						yield* Stream.runCollect(yield* toolkit.handle('read_resource_history', {minutes: 60, series: true}))
					)
				)
			)
			assert.isBelow(Formatter.formatJson(answer.encodedResult).length, 6000)
			const machines = (yield* Schema.decodeUnknownEffect(Schema.Struct({workers: ResourceHistory}))(
				answer.encodedResult
			)).workers
			assert.lengthOf(machines, 2)
			for (const machine of machines) {
				assert.lengthOf(machine.memoryPct, 60)
				assert.lengthOf(machine.cpuPct, 60)
				assert.lengthOf(machine.diskPct, 60)
				assert.strictEqual(machine.stepSeconds, 60)
				assert.strictEqual(machine.from, DateTime.formatIso(DateTime.makeUnsafe(chartWindow(60, NOW).start)))
				assert.isTrue(Option.isNone(machine.cpuPct[0] ?? Option.none()))
				assert.isTrue(Option.isSome(machine.cpuPct[1] ?? Option.none()))
				assert.strictEqual(Option.getOrThrow(Array.findFirst(machine.apps, app => app.name === 'stash')).mib, 3072)
				assert.lengthOf(machine.apps, 16)
				assert.strictEqual(machine.apps[15]?.name, 'other')
				assert.isFalse(Array.some(machine.apps, app => String.startsWith('container ')(app.name)))
				assert.strictEqual(machine.now?.diskTotalGiB, 500)
				assert.strictEqual(machine.now?.memoryTotalGiB, 16)
				assert.deepStrictEqual(machine.now?.load, [1.5, 1.2, 0.9])
			}
			const devMachine = Option.getOrThrow(Array.findFirst(machines, machine => machine.worker === 'dev'))
			assert.isUndefined(devMachine.error)
			assert.isUndefined(devMachine.stale)
			const desktopMachine = Option.getOrThrow(Array.findFirst(machines, machine => machine.worker === 'desktop'))
			assert.strictEqual(desktopMachine.error, 'Worker unavailable')
			assert.strictEqual(desktopMachine.stale, true)
			const one = Option.getOrThrow(
				Array.last(
					Array.fromIterable(
						yield* Stream.runCollect(
							yield* toolkit.handle('read_resource_history', {minutes: 60, series: true, worker: 'desktop'})
						)
					)
				)
			)
			assert.lengthOf(
				(yield* Schema.decodeUnknownEffect(Schema.Struct({workers: ResourceHistory}))(one.encodedResult)).workers,
				1
			)
		})
	)
)

it.effect('runs a scheduled job through the deploy.run path', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const started = yield* Ref.make(Option.none<RunRequest>())
			const snapshot = Snapshot.make({
				items: [jobItem('dev', 0), jobItem('dev', 1)],
				sources: [],
				time: NOW,
				workers: ['dev']
			})
			const toolkit = yield* toolkitFor(
				fleetOf({run: request => Ref.set(started, Option.some(request)), snapshot: Effect.succeed(snapshot)})
			)
			assert.deepStrictEqual(
				Option.getOrThrow(
					Array.last(Array.fromIterable(yield* Stream.runCollect(yield* toolkit.handle('run_job', {job: 'backup-1'}))))
				).encodedResult,
				{started: true}
			)
			assert.deepStrictEqual(Option.getOrThrow(yield* Ref.get(started)), {name: 'backup-1.service', scope: 'user'})
		})
	)
)

it.effect('exposes and hides a port through the composed MCP tools', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const exposed = yield* Ref.make(Option.none<ExposeRequest>())
			const hidden = yield* Ref.make(Option.none<HideRequest>())
			const toolkit = yield* toolkitFor(
				fleetOf({
					expose: input => Effect.as(Ref.set(exposed, Option.some(input)), 'https://desktop.tailnet-8c4c.ts.net:4000'),
					hide: input => Ref.set(hidden, Option.some(input)),
					snapshot: Effect.succeed(Snapshot.make({items: [], sources: [], time: NOW, workers: ['dev', 'desktop']}))
				})
			)
			const request = {
				hostname: 'desktop.tailnet-8c4c.ts.net',
				kind: 'tailnet' as const,
				name: 'preview',
				port: 4000,
				publicAccess: false,
				worker: 'desktop'
			}
			const answer = Option.getOrThrow(
				Array.last(Array.fromIterable(yield* Stream.runCollect(yield* toolkit.handle('create_exposure', request))))
			)
			assert.deepStrictEqual(answer.encodedResult, {url: 'https://desktop.tailnet-8c4c.ts.net:4000'})
			assert.deepStrictEqual(Option.getOrThrow(yield* Ref.get(exposed)), {
				hostname: request.hostname,
				kind: request.kind,
				name: request.name,
				port: request.port,
				publicAccess: request.publicAccess,
				target: request.worker
			})
			yield* Stream.runDrain(yield* toolkit.handle('remove_exposure', {name: 'preview', worker: 'desktop'}))
			assert.deepStrictEqual(Option.getOrThrow(yield* Ref.get(hidden)), {name: 'preview', target: 'desktop'})
		})
	)
)
