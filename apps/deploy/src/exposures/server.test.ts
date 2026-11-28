import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {
	Array,
	Boolean,
	Context,
	DateTime,
	Deferred,
	Effect,
	Fiber,
	FileSystem,
	Layer,
	MutableRef,
	Option,
	Queue,
	Record,
	pipe
} from 'effect'

import {TestClock} from 'effect/testing'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'
import type {RuntimeConfig} from '@deslop/runtime/shared/schema'

import {DeployError} from '#contracts'

import type {Exposure} from './contract.ts'
import {Exposures} from './server.ts'

import {ExposureName, InventoryItem, ItemId, UnitId} from '#inventory/contract.ts'
import {Inventory} from '#inventory/server.ts'
import type {Serve} from '#proxies/contract.ts'
import {Proxies} from '#proxies/server.ts'

const WEB = {
	hostname: 'web.example.com',
	kind: 'public' as const,
	name: ExposureName.make('web'),
	port: 5173,
	publicAccess: true
}

function listening(unit: string, port = 5173) {
	return InventoryItem.make({
		address: Option.some(`127.0.0.1:${port}`),
		detail: '',
		id: ItemId.make(`test:port:tcp:127.0.0.1:${port}`),
		kind: 'port',
		name: `127.0.0.1:${port}`,
		port: Option.some(port),
		protocol: Option.some('tcp'),
		scope: Option.some('user'),
		state: 'LISTEN',
		unit: Option.some(UnitId.make(unit)),
		url: Option.none()
	})
}

// The worker as a test sets it: what listens on port 5173 (and, as another unit, on 5174), what the inventory last read of it, whether Caddy loads a change, and Tailscale Serve's mappings; each set of sites Caddy is asked to load is queued by name.
const worker = Effect.fnUntraced(function* () {
	const owner = MutableRef.make(Option.some('web.service'))
	const seen = MutableRef.make(Option.some('web.service'))
	const caddyUp = MutableRef.make(true)
	const gate = MutableRef.make(Option.none<Deferred.Deferred<void>>())
	const afterCheck = MutableRef.make(Effect.void)
	const serving = MutableRef.make<Serve>({AllowFunnel: Option.none(), TCP: Option.none(), Web: Option.none()})
	const unserveFails = MutableRef.make(false)
	const statusUnreadable = MutableRef.make(false)
	const afterUnserve = MutableRef.make(Effect.void)
	const asked = yield* Queue.unbounded<readonly string[]>()
	const probed = yield* Queue.unbounded<number>()
	const unserved = yield* Queue.unbounded<number>()
	const layer = Layer.mergeAll(
		Layer.mock(Proxies, {
			apply: Effect.fnUntraced(function* (rows: readonly Exposure[]) {
				yield* Queue.offer(
					asked,
					Array.map(rows, row => row.name)
				)
				yield* Option.match(MutableRef.get(gate), {onNone: () => Effect.void, onSome: Deferred.await})
				if (!MutableRef.get(caddyUp)) return yield* DeployError.make({message: 'Caddy is down'})
			}),
			runtime: Effect.fnUntraced(function* (port: number) {
				yield* Queue.offer(probed, port)
				return Option.none<RuntimeConfig>()
			}),
			serve: port =>
				Effect.sync(() => {
					MutableRef.update(serving, status => ({
						...status,
						TCP: Option.some({...Option.getOrElse(status.TCP, () => ({})), [`${port}`]: {HTTPS: true}}),
						Web: Option.some({
							...Option.getOrElse(status.Web, () => ({})),
							[`web.ts.net:${port}`]: {Handlers: {'/': {Proxy: Option.some(`http://127.0.0.1:${port}`)}}}
						})
					}))
				}),
			serveStatus: Effect.suspend(() =>
				Boolean.match(MutableRef.get(statusUnreadable), {
					onFalse: () => Effect.succeed(MutableRef.get(serving)),
					onTrue: () => DeployError.make({message: 'Tailscale is down'})
				})
			),
			tailnetName: Effect.succeedSome('web.ts.net'),
			unserve: Effect.fnUntraced(function* (port: number) {
				yield* Queue.offer(unserved, port)
				if (MutableRef.get(unserveFails)) return yield* DeployError.make({message: 'Tailscale is down'})
				MutableRef.update(serving, status => ({
					...status,
					TCP: Option.map(status.TCP, Record.remove(`${port}`)),
					Web: Option.map(status.Web, Record.remove(`web.ts.net:${port}`))
				}))
				yield* MutableRef.get(afterUnserve)
			}),
			validate: () => MutableRef.get(afterCheck)
		}),
		Layer.mock(Inventory, {
			ensureFresh: Effect.void,
			refresh: Effect.sync(() => MutableRef.set(seen, MutableRef.get(owner))),
			snapshot: Effect.map(DateTime.now, time => ({
				items: [
					...Option.toArray(Option.map(MutableRef.get(seen), unit => listening(unit))),
					listening('second.service', 5174)
				],
				sources: [],
				time
			}))
		})
	)
	return {
		afterCheck,
		afterUnserve,
		asked,
		caddyUp,
		gate,
		layer,
		owner,
		probed,
		serving,
		statusUnreadable,
		unserveFails,
		unserved
	}
})

// One Deploy start over the database in `folder`, for this scope; a second start on the same folder is a restart.
function start(folder: string, standIns: Layer.Layer<Proxies | Inventory>) {
	return Effect.map(
		Layer.build(
			pipe(
				Layer.effect(Exposures, Exposures.make),
				Layer.provide(Exposures.migrations),
				Layer.provide(standIns),
				Layer.provide(layerDataStore(folder))
			)
		),
		Context.get(Exposures)
	)
}

const admin = requireAdmin({admin: true, id: UserId.make('github:1'), name: 'admin'}, 'Admin required')

function tailnet(name: string, port: number) {
	return {hostname: 'web.ts.net', kind: 'tailnet' as const, name: ExposureName.make(name), port, publicAccess: false}
}

function states(items: Effect.Success<typeof Exposures.Service.items>) {
	return Array.map(items, item => [item.name, item.state, item.health] as const)
}

it.layer(NodeServices.layer)(test => {
	test.effect(
		'a removal saved before a restart finishes after it and is never published again',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const host = yield* worker()
			yield* Effect.scoped(
				Effect.gen(function* () {
					const exposures = yield* start(folder, host.layer)
					assert.strictEqual(yield* exposures.expose(WEB, yield* admin), 'https://web.example.com')
					MutableRef.set(host.caddyUp, false)
					assert.instanceOf(yield* Effect.flip(exposures.hide(WEB.name, yield* admin)), DeployError)
					assert.deepStrictEqual(states(yield* exposures.items), [['web', 'removing', 'warning']])
				})
			)
			MutableRef.set(host.caddyUp, true)
			yield* Effect.scoped(
				Effect.gen(function* () {
					assert.deepStrictEqual(yield* (yield* start(folder, host.layer)).items, [])
				})
			)
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [['web'], [], []])
		}, Effect.scoped)
	)

	test.effect(
		'a Caddy change that failed is applied again by the reconciler, without another request',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			MutableRef.set(host.caddyUp, false)
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			assert.instanceOf(yield* Effect.flip(exposures.expose(WEB, yield* admin)), DeployError)
			assert.deepStrictEqual(states(yield* exposures.items), [['web', 'configured; check backend', 'warning']])
			assert.deepStrictEqual(yield* Queue.take(host.asked), ['web'])
			MutableRef.set(host.caddyUp, true)
			yield* TestClock.adjust('5 seconds')
			assert.deepStrictEqual(yield* Queue.take(host.asked), ['web'])
		}, Effect.scoped)
	)

	test.effect(
		'a removal after a failed Caddy load loads Caddy again before its row is deleted',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			yield* exposures.expose(WEB, yield* admin)
			MutableRef.set(host.caddyUp, false)
			const second = {...WEB, hostname: 'second.example.com', name: ExposureName.make('second'), port: 5174}
			assert.instanceOf(yield* Effect.flip(exposures.expose(second, yield* admin)), DeployError)
			MutableRef.set(host.caddyUp, true)
			yield* exposures.hide(second.name, yield* admin)
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [['web'], ['second', 'web'], ['web']])
			assert.deepStrictEqual(states(yield* exposures.items), [['web', 'configured; check backend', 'quiet']])
		}, Effect.scoped)
	)

	test.effect(
		'Caddy’s admin port is refused before anything connects to it',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			assert.instanceOf(yield* Effect.flip(exposures.expose({...WEB, port: 20_219}, yield* admin)), DeployError)
			assert.strictEqual(yield* Queue.size(host.probed), 0)
		}, Effect.scoped)
	)

	test.effect(
		'an exposure whose port changed owner while Deploy was down is not published again, and says why',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const host = yield* worker()
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* (yield* start(folder, host.layer)).expose(WEB, yield* admin)
				})
			)
			MutableRef.set(host.owner, Option.some('other.service'))
			const items = yield* (yield* start(folder, host.layer)).items
			assert.deepStrictEqual(states(items), [['web', 'configured; check backend', 'warning']])
			assert.include(
				Option.getOrThrow(Option.flatMap(Array.head(items), item => item.failure)).reason,
				'now belongs to user:other.service'
			)
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [['web'], []])
		}, Effect.scoped)
	)

	test.effect(
		'an exposure whose port changed owner while Caddy refuses loads says its withdrawal has not reached Caddy',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			yield* exposures.expose(WEB, yield* admin)
			MutableRef.set(host.owner, Option.some('other.service'))
			MutableRef.set(host.caddyUp, false)
			assert.instanceOf(
				yield* Effect.flip(
					exposures.expose(
						{...WEB, hostname: 'second.example.com', name: ExposureName.make('second'), port: 5174},
						yield* admin
					)
				),
				DeployError
			)
			const reason = pipe(
				yield* exposures.items,
				Array.findFirst(item => item.name === WEB.name),
				Option.flatMap(item => item.failure),
				Option.getOrThrow
			).reason
			assert.include(reason, 'now belongs to user:other.service')
			assert.include(reason, 'Caddy has not loaded this yet: Caddy is down')
		}, Effect.scoped)
	)

	test.effect(
		'an exposure whose port nobody listens on is not published, and is published again once its owner listens',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const host = yield* worker()
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* (yield* start(folder, host.layer)).expose(WEB, yield* admin)
				})
			)
			MutableRef.set(host.owner, Option.none())
			const exposures = yield* start(folder, host.layer)
			const items = yield* exposures.items
			assert.deepStrictEqual(states(items), [['web', 'configured; check backend', 'warning']])
			assert.include(
				Option.getOrThrow(Option.flatMap(Array.head(items), item => item.failure)).reason,
				'Nothing listens'
			)
			MutableRef.set(host.owner, Option.some('web.service'))
			yield* TestClock.adjust('5 seconds')
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [['web'], [], ['web']])
			assert.deepStrictEqual(states(yield* exposures.items), [['web', 'configured; check backend', 'quiet']])
		}, Effect.scoped)
	)

	test.effect(
		'a listener swapped after expose checked the port is held by the pass that follows the save',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			MutableRef.set(
				host.afterCheck,
				Effect.sync(() => MutableRef.set(host.owner, Option.some('other.service')))
			)
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			assert.instanceOf(yield* Effect.flip(exposures.expose(WEB, yield* admin)), DeployError)
			assert.include(
				Option.getOrThrow(Option.flatMap(Array.head(yield* exposures.items), item => item.failure)).reason,
				'now belongs to user:other.service'
			)
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [[]])
		}, Effect.scoped)
	)

	test.effect(
		'a removal waits for a pass already applying rows, and the next pass never publishes the row again',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			MutableRef.set(host.caddyUp, false)
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			yield* Effect.flip(exposures.expose(WEB, yield* admin))
			const release = yield* Deferred.make<void>()
			MutableRef.set(host.gate, Option.some(release))
			yield* Queue.takeAll(host.asked)
			yield* TestClock.adjust('5 seconds')
			assert.deepStrictEqual(yield* Queue.take(host.asked), ['web'])
			const removal = yield* Effect.forkChild(exposures.hide(WEB.name, yield* admin), {startImmediately: true})
			yield* Effect.forEach(Array.range(1, 50), () => Effect.yieldNow, {concurrency: 1, discard: true})
			assert.deepStrictEqual(states(yield* exposures.items), [['web', 'configured; check backend', 'warning']])
			MutableRef.set(host.gate, Option.none())
			MutableRef.set(host.caddyUp, true)
			yield* Deferred.succeed(release, undefined)
			yield* Fiber.join(removal)
			assert.deepStrictEqual(yield* exposures.items, [])
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [[]])
		}, Effect.scoped)
	)

	test.effect(
		'a tailnet mapping changed after the pass began is left alone when a later row’s removal would drop it',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			yield* exposures.expose(tailnet('first', 5173), yield* admin)
			yield* exposures.expose(tailnet('second', 5174), yield* admin)
			MutableRef.set(host.unserveFails, true)
			yield* Effect.flip(exposures.hide(ExposureName.make('first'), yield* admin))
			MutableRef.set(host.unserveFails, false)
			MutableRef.set(
				host.afterUnserve,
				Effect.sync(() => {
					MutableRef.update(host.serving, status => ({
						...status,
						Web: Option.map(
							status.Web,
							Record.set('web.ts.net:5174', {Handlers: {'/': {Proxy: Option.some('http://127.0.0.1:9')}}})
						)
					}))
				})
			)
			yield* exposures.hide(ExposureName.make('second'), yield* admin)
			assert.deepStrictEqual(yield* Queue.takeAll(host.unserved), [5173, 5173])
			assert.deepStrictEqual(yield* exposures.items, [])
		}, Effect.scoped)
	)

	test.effect(
		'a tailnet removal is saved while Tailscale Serve cannot be read, and finishes once it can',
		Effect.fnUntraced(function* () {
			const host = yield* worker()
			const exposures = yield* start(yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped(), host.layer)
			yield* exposures.expose(tailnet('first', 5173), yield* admin)
			MutableRef.set(host.statusUnreadable, true)
			assert.instanceOf(yield* Effect.flip(exposures.hide(ExposureName.make('first'), yield* admin)), DeployError)
			assert.deepStrictEqual(states(yield* exposures.items), [['first', 'removing', 'warning']])
			MutableRef.set(host.statusUnreadable, false)
			yield* TestClock.adjust('5 seconds')
			assert.deepStrictEqual(yield* Queue.takeAll(host.unserved), [5173])
			assert.deepStrictEqual(yield* exposures.items, [])
		}, Effect.scoped)
	)
})
