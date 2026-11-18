import {hostname} from 'node:os'

import {Array, Boolean, Effect, HashSet, Option, Order, String, Struct, pipe} from 'effect'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {CurrentUser} from '@deslop/runtime/shared/auth'

import {Fleet} from '#services/fleet/service.ts'
import {jobRequest, listApps, ownerNames} from '#services/inventory/lib/utils.ts'
import {DeployError, WorkerId} from '#services/inventory/schema.ts'
import type {InventoryCursor, ProcessSummary, WorkerInventory} from '#services/inventory/schema.ts'
import {resourceHistory} from '#services/metrics/lib/utils.ts'
import {ToolContracts} from '#tools/contracts.ts'

// A target is checked against the configured workers, so a command never waits on reading the fleet first.
function checkWorker(workers: readonly WorkerId[], worker: Option.Option<WorkerId>) {
	return pipe(
		worker,
		Option.filter(selected => !Array.contains(workers, selected)),
		Option.match({
			onNone: () => Effect.void,
			onSome: selected =>
				Effect.fail(
					DeployError.make({
						message: `Unknown worker ${selected}; valid workers: ${Array.join(workers, ', ')}. Nothing changed.`
					})
				)
		})
	)
}

function processPaths(tree: readonly ProcessSummary[], prefix: string): readonly string[] {
	return Array.flatMap(tree, (node, index) => [
		`${prefix}${index}`,
		...processPaths(Option.getOrElse(node.children, Array.empty), `${prefix}${index}.`)
	])
}

function processPage(nodes: readonly ProcessSummary[], offset: number, limit: number) {
	const all = processPaths(nodes, '')
	const selected = pipe(
		all,
		Array.drop(offset),
		Array.take(limit),
		Array.flatMap(path =>
			pipe(
				path,
				String.split('.'),
				Array.scan('', (prefix, part) => `${prefix}${part}.`),
				Array.drop(1)
			)
		),
		HashSet.fromIterable
	)
	function visit(tree: readonly ProcessSummary[], prefix: string): readonly ProcessSummary[] {
		return Array.flatMap(tree, (node, index) => {
			const path = `${prefix}${index}`
			if (!HashSet.has(selected, `${path}.`)) return []
			const children = visit(Option.getOrElse(node.children, Array.empty), `${path}.`)
			return [
				{...Struct.omit(node, ['children']), children: Option.liftPredicate(children, Array.isReadonlyArrayNonEmpty)}
			]
		})
	}

	return {
		nextProcessOffset: Option.liftPredicate(offset + limit, next => all.length > next),
		processes: visit(nodes, ''),
		processesOmitted: Option.liftPredicate(all.length - HashSet.size(selected), count => count > 0)
	}
}

const cursorOrder = pipe(
	Order.mapInput(Order.String, (key: InventoryCursor) => key[0]),
	Order.combine(Order.mapInput(Order.String, (key: InventoryCursor) => key[1])),
	Order.combine(Order.mapInput(Order.String, (key: InventoryCursor) => key[2]))
)

function inventoryPage(
	workers: readonly WorkerInventory[],
	input: {cursor: Option.Option<InventoryCursor>; limit: number; processLimit: number; processOffset: number}
) {
	const remaining = pipe(
		workers,
		Array.flatMap(worker => [
			...Array.map(worker.apps, row => [worker.worker, 'apps', row.id] satisfies InventoryCursor),
			...pipe(
				worker.jobs,
				Option.getOrElse(Array.empty),
				Array.map(row => [worker.worker, 'jobs', row.id] satisfies InventoryCursor)
			),
			...pipe(
				worker.exposures,
				Option.getOrElse(Array.empty),
				Array.map(row => [worker.worker, 'exposures', row.id] satisfies InventoryCursor)
			)
		]),
		Array.sort(cursorOrder),
		Array.filter(key => !Option.exists(input.cursor, cursor => Order.isLessThanOrEqualTo(cursorOrder)(key, cursor)))
	)
	const page = Array.take(remaining, input.limit)
	const selected = HashSet.fromIterable(page)
	return {
		nextCursor: pipe(
			page,
			Array.last,
			Option.filter(() => remaining.length > input.limit)
		),
		workers: Array.map(workers, worker => ({
			...Struct.pick(worker, ['worker', 'errors']),
			apps: pipe(
				worker.apps,
				Array.filter(row => HashSet.has(selected, [worker.worker, 'apps', row.id])),
				Array.map(row =>
					Option.match(row.processes, {
						onNone: () => ({...row, nextProcessOffset: Option.none<number>(), processesOmitted: Option.none<number>()}),
						onSome: processes => {
							const result = processPage(processes, input.processOffset, input.processLimit)
							return {...row, ...result, processes: Option.some(result.processes)}
						}
					})
				)
			),
			exposures: Option.map(worker.exposures, exposures =>
				Array.filter(exposures, row => HashSet.has(selected, [worker.worker, 'exposures', row.id]))
			),
			jobs: Option.map(worker.jobs, jobs =>
				Array.filter(jobs, row => HashSet.has(selected, [worker.worker, 'jobs', row.id]))
			)
		}))
	}
}

function focusedInventory(workers: readonly WorkerInventory[], app: Option.Option<string>) {
	return Option.match(app, {
		onNone: () => workers,
		onSome: queryText => {
			const query = String.toLowerCase(queryText)
			function matchingName(row: {readonly name: string}) {
				return pipe(row.name, String.toLowerCase, String.includes(query))
			}
			return Array.map(workers, worker => ({
				...worker,
				exposures: pipe(
					worker.exposures,
					Option.map(rows => Array.filter(rows, matchingName)),
					Option.orElseSome(() => [])
				),
				jobs: pipe(
					worker.jobs,
					Option.map(rows => Array.filter(rows, matchingName)),
					Option.orElseSome(() => [])
				)
			}))
		}
	})
}

function metricSummary(series: readonly Option.Option<number>[]) {
	const values = Array.getSomes(series)
	return {
		last: Option.flatten(Array.last(series)),
		max: Array.match(values, {
			onEmpty: () => Option.none(),
			onNonEmpty: measured => Option.some(Array.max(measured, Order.Number))
		}),
		min: Array.match(values, {
			onEmpty: () => Option.none(),
			onNonEmpty: measured => Option.some(Array.min(measured, Order.Number))
		}),
		samples: values.length
	}
}

export const ToolHandlers = ToolContracts.toLayer(
	Effect.map(Fleet, fleet =>
		ToolContracts.of({
			create_exposure: Effect.fnUntraced(function* (input) {
				const admin = yield* requireAdmin(yield* CurrentUser, 'Only an admin can create exposures')
				yield* checkWorker(fleet.workers, input.worker)
				return {
					url: yield* fleet.expose(
						{...input, worker: Option.getOrElse(input.worker, () => WorkerId.make(hostname()))},
						admin
					)
				}
			}),
			list_apps: Effect.fnUntraced(function* (input) {
				yield* checkWorker(fleet.workers, input.worker)
				return inventoryPage(focusedInventory(listApps(yield* fleet.snapshot, input), input.app), input)
			}),
			read_resource_history: Effect.fnUntraced(function* (input) {
				yield* checkWorker(fleet.workers, input.worker)
				const value = yield* Effect.all(
					{
						machines: Effect.andThen(fleet.metrics({minutes: input.minutes}), fleet.current({minutes: input.minutes})),
						snapshot: fleet.snapshot
					},
					{concurrency: 'unbounded'}
				)
				return {
					workers: Array.map(resourceHistory(value.machines, input, ownerNames(value.snapshot)), worker =>
						Boolean.match(input.series, {
							onFalse: () => ({
								...worker,
								cpuPct: metricSummary(worker.cpuPct),
								diskPct: metricSummary(worker.diskPct),
								memoryPct: metricSummary(worker.memoryPct)
							}),
							onTrue: () => worker
						})
					)
				}
			}),
			remove_exposure: Effect.fnUntraced(function* (input) {
				const admin = yield* requireAdmin(yield* CurrentUser, 'Only an admin can remove exposures')
				yield* checkWorker(fleet.workers, input.worker)
				yield* fleet.hide(
					{name: input.name, worker: Option.getOrElse(input.worker, () => WorkerId.make(hostname()))},
					admin
				)
				return input
			}),
			run_job: Effect.fnUntraced(function* (input) {
				const admin = yield* requireAdmin(yield* CurrentUser, 'Only an admin can run jobs')
				yield* checkWorker(fleet.workers, input.worker)
				yield* fleet.run(yield* jobRequest(yield* fleet.snapshot, input), admin)
				return {started: true as const}
			})
		})
	)
)
