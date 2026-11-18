import {NodeServices} from '@effect/platform-node'
import {assert, it} from '@effect/vitest'

import {Array, Context, DateTime, Effect, FileSystem, Layer, MutableRef, Option, Queue, pipe} from 'effect'

import {TestClock} from 'effect/testing'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {layerDataStore} from '@deslop/runtime/server/store'
import {UserId} from '@deslop/runtime/shared/auth'

import {Exposures} from './service.ts'

import type {Exposure} from '#services/exposures/schema.ts'
import {DeployError, ExposureName, InventoryItem, ItemId, UnitId, WorkerId} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {Proxies} from '#services/proxies/service.ts'

const WEB = {
	hostname: 'web.example.com',
	kind: 'public' as const,
	name: ExposureName.make('web'),
	port: 5173,
	publicAccess: true
}

function listening(unit: string) {
	return InventoryItem.make({
		address: Option.some('127.0.0.1:5173'),
		detail: '',
		id: ItemId.make('test:port:tcp:127.0.0.1:5173'),
		kind: 'port',
		name: '127.0.0.1:5173',
		port: Option.some(5173),
		protocol: Option.some('tcp'),
		scope: Option.some('user'),
		state: 'LISTEN',
		unit: Option.some(UnitId.make(unit)),
		url: Option.none(),
		worker: WorkerId.make('test')
	})
}

// The worker as a test sets it: what listens on port 5173 and whether Caddy loads a change; each set of sites Caddy is asked to load is queued by name.
const worker = Effect.fnUntraced(function* () {
	const owner = MutableRef.make('web.service')
	const caddyUp = MutableRef.make(true)
	const asked = yield* Queue.unbounded<readonly string[]>()
	const layer = Layer.mergeAll(
		Layer.mock(Proxies, {
			apply: Effect.fnUntraced(function* (rows: readonly Exposure[]) {
				yield* Queue.offer(
					asked,
					Array.map(rows, row => row.name)
				)
				if (!MutableRef.get(caddyUp)) return yield* DeployError.make({message: 'Caddy is down'})
			}),
			runtime: () => Effect.succeedNone,
			validate: () => Effect.void
		}),
		Layer.mock(Inventory, {
			ensureFresh: Effect.void,
			refresh: Effect.void,
			snapshot: Effect.map(DateTime.now, time => ({
				items: [listening(MutableRef.get(owner))],
				sources: [],
				time,
				workers: []
			}))
		})
	)
	return {asked, caddyUp, layer, owner}
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
		'an exposure whose port changed owner while Deploy was down is not published again, and says why',
		Effect.fnUntraced(function* () {
			const folder = yield* (yield* FileSystem.FileSystem).makeTempDirectoryScoped()
			const host = yield* worker()
			yield* Effect.scoped(
				Effect.gen(function* () {
					yield* (yield* start(folder, host.layer)).expose(WEB, yield* admin)
				})
			)
			MutableRef.set(host.owner, 'other.service')
			const items = yield* (yield* start(folder, host.layer)).items
			assert.deepStrictEqual(states(items), [['web', 'configured; check backend', 'warning']])
			assert.include(
				Option.getOrThrow(Option.flatMap(Array.head(items), item => item.failure)).reason,
				'now belongs to user:other.service'
			)
			assert.deepStrictEqual(yield* Queue.takeAll(host.asked), [['web'], []])
		}, Effect.scoped)
	)
})
