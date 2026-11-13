import {assert, it} from '@effect/vitest'

import {Array, Effect, Formatter, Layer, Option, Ref, Schema, Stream, pipe} from 'effect'

import type {HideRequest} from '#services/exposures/schema.ts'
import {Fleet} from '#services/fleet/service.ts'
import {type InventoryItem, Inventory, Snapshot} from '#services/inventory/schema.ts'
import {MachineHistory} from '#services/metrics/schema.ts'
import {ToolContracts} from '#tools/contracts.ts'
import {ToolHandlers} from '#tools/handlers.ts'

const NOW = Date.UTC(2026, 10, 10, 12)

function fleetOf(overrides: Partial<Parameters<typeof Fleet.of>[0]>) {
	const snapshot = Snapshot.make({items: [], sources: [], time: 0})
	const machine = MachineHistory.make({
		disks: [],
		error: '',
		load: [],
		samples: [],
		stale: false,
		time: 0,
		worker: 'dev'
	})
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

function toolkitFor(fleet: Parameters<typeof Fleet.of>[0]) {
	return Effect.flatMap(Layer.build(pipe(ToolHandlers, Layer.provide(Layer.succeed(Fleet, fleet)))), context =>
		Effect.provideContext(ToolContracts, context)
	)
}

it.effect('attributes a bare remote source to its own worker, never the local one', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const snapshot = Snapshot.make({
				items: [],
				sources: [
					{error: '', name: 'Docker'},
					{error: 'worker unavailable', name: 'desktop'},
					{error: 'tailscale timed out', name: 'desktop · Tailscale'}
				],
				time: NOW,
				workers: ['dev', 'desktop']
			})
			const toolkit = yield* toolkitFor(fleetOf({snapshot: Effect.succeed(snapshot)}))
			const answer = Option.getOrThrow(
				Array.last(Array.fromIterable(yield* Stream.runCollect(yield* toolkit.handle('list_apps', {}))))
			)
			const workers = (yield* Schema.decodeUnknownEffect(Schema.Struct({workers: Inventory}))(answer.encodedResult))
				.workers
			const dev = Option.getOrThrow(Array.findFirst(workers, worker => worker.worker === 'dev'))
			const desktop = Option.getOrThrow(Array.findFirst(workers, worker => worker.worker === 'desktop'))
			assert.isUndefined(dev.errors)
			assert.deepStrictEqual(desktop.errors, ['desktop: worker unavailable', 'Tailscale: tailscale timed out'])
		})
	)
)

it.effect('names an exposure list_apps returns and hides it by that name', () =>
	Effect.scoped(
		Effect.gen(function* () {
			const hidden = yield* Ref.make(Option.none<HideRequest>())
			const exposure = {
				detail: 'tailnet → 127.0.0.1:5000',
				id: 'dev:exposure:svc-3',
				kind: 'exposure',
				name: 'svc-3',
				owned: true,
				port: 5000,
				publicAccess: false,
				state: 'configured; check backend',
				url: 'https://svc-3.example.ts.net',
				worker: 'dev'
			} satisfies InventoryItem
			const snapshot = Snapshot.make({items: [exposure], sources: [], time: NOW, workers: ['dev']})
			const toolkit = yield* toolkitFor(
				fleetOf({hide: input => Ref.set(hidden, Option.some(input)), snapshot: Effect.succeed(snapshot)})
			)
			const listed = Option.getOrThrow(
				Array.last(Array.fromIterable(yield* Stream.runCollect(yield* toolkit.handle('list_apps', {}))))
			)
			const workers = (yield* Schema.decodeUnknownEffect(Schema.Struct({workers: Inventory}))(listed.encodedResult))
				.workers
			assert.lengthOf(workers, 1)
			const dev = Option.getOrThrow(Array.head(workers))
			assert.strictEqual(dev.worker, 'dev')
			const listedExposure = Option.getOrThrow(Array.head(dev.exposures ?? []))
			assert.strictEqual(listedExposure.name, 'svc-3')
			assert.include(Formatter.formatJson(listed.encodedResult), '"name":"svc-3"')
			const answer = Option.getOrThrow(
				Array.last(
					Array.fromIterable(
						yield* Stream.runCollect(yield* toolkit.handle('remove_exposure', {name: listedExposure.name}))
					)
				)
			)
			assert.isFalse(answer.isFailure)
			assert.deepStrictEqual(Option.getOrThrow(yield* Ref.get(hidden)), {name: 'svc-3'})
		})
	)
)
