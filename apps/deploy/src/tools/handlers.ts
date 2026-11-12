import {Array, Boolean, Effect, HashSet, Option, Order, String, Struct, pipe} from 'effect'

import {Fleet} from '#services/fleet/service.ts'
import {jobRequest, listApps, ownerNames} from '#services/inventory/lib/utils.ts'
import {DeployError} from '#services/inventory/schema.ts'
import type {ProcessSummary, WorkerInventory} from '#services/inventory/schema.ts'
import {resourceHistory} from '#services/metrics/lib/utils.ts'
import {ToolContracts} from '#tools/contracts.ts'

function checkWorker(workers: readonly {worker: string}[], worker?: string) {
	if (worker !== undefined && !Array.some(workers, row => row.worker === worker)) {
		return Effect.fail(
			DeployError.make({
				message: `Unknown worker ${worker}; valid workers: ${Array.join(
					Array.map(workers, row => row.worker),
					', '
				)}. Nothing changed.`
			})
		)
	}
	return Effect.void
}

function processPaths(tree: readonly ProcessSummary[], prefix: string): readonly string[] {
	return Array.flatMap(tree, (node, index) => [
		`${prefix}${index}`,
		...processPaths(node.children ?? [], `${prefix}${index}.`)
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
			const children = visit(node.children ?? [], `${path}.`)
			return [
				{
					...Struct.omit(node, ['children']),
					...Boolean.match(Array.isReadonlyArrayNonEmpty(children), {onFalse: () => ({}), onTrue: () => ({children})})
				}
			]
		})
	}

	return {
		processes: visit(nodes, ''),
		...Boolean.match(all.length > offset + limit, {
			onFalse: () => ({}),
			onTrue: () => ({nextProcessOffset: offset + limit})
		}),
		...Boolean.match(all.length > HashSet.size(selected), {
			onFalse: () => ({}),
			onTrue: () => ({processesOmitted: all.length - HashSet.size(selected)})
		})
	}
}

function inventoryPage(
	workers: readonly WorkerInventory[],
	input: {cursor?: string; limit: number; processLimit: number; processOffset: number}
) {
	const remaining = pipe(
		workers,
		Array.flatMap(worker => [
			...Array.map(worker.apps, row => `${worker.worker}\tapps\t${row.id}`),
			...Array.map(worker.jobs ?? [], row => `${worker.worker}\tjobs\t${row.id}`),
			...Array.map(worker.exposures ?? [], row => `${worker.worker}\texposures\t${row.id}`)
		]),
		Array.sort(Order.String),
		Array.filter(key => input.cursor === undefined || key > input.cursor)
	)
	const page = Array.take(remaining, input.limit)
	const selected = HashSet.fromIterable(page)
	return {
		...pipe(
			page,
			Array.last,
			Option.filter(() => remaining.length > input.limit),
			Option.match({onNone: () => ({}), onSome: nextCursor => ({nextCursor})})
		),
		workers: Array.map(workers, worker => ({
			...Struct.pick(worker, ['worker', 'errors']),
			apps: pipe(
				worker.apps,
				Array.filter(row => HashSet.has(selected, `${worker.worker}\tapps\t${row.id}`)),
				Array.map(row => {
					if (row.processes === undefined) return row
					return {...row, ...processPage(row.processes, input.processOffset, input.processLimit)}
				})
			),
			...Option.match(Option.fromUndefinedOr(worker.jobs), {
				onNone: () => ({}),
				onSome: jobs => ({jobs: Array.filter(jobs, row => HashSet.has(selected, `${worker.worker}\tjobs\t${row.id}`))})
			}),
			...Option.match(Option.fromUndefinedOr(worker.exposures), {
				onNone: () => ({}),
				onSome: exposures => ({
					exposures: Array.filter(exposures, row => HashSet.has(selected, `${worker.worker}\texposures\t${row.id}`))
				})
			})
		}))
	}
}

function focusedInventory(workers: readonly WorkerInventory[], app?: string) {
	if (app === undefined) return workers
	const query = String.toLowerCase(app)
	return Array.map(workers, worker => ({
		...worker,
		exposures: Array.filter(worker.exposures ?? [], row => pipe(row.name, String.toLowerCase, String.includes(query))),
		jobs: Array.filter(worker.jobs ?? [], row => pipe(row.name, String.toLowerCase, String.includes(query)))
	}))
}

function metricSummary(series: readonly Option.Option<number>[]) {
	const values = Array.getSomes(series)
	return {
		samples: values.length,
		...pipe(series, Array.last, Option.flatten, Option.match({onNone: () => ({}), onSome: last => ({last})})),
		...Array.match(values, {
			onEmpty: () => ({}),
			onNonEmpty: measured => ({max: Array.max(measured, Order.Number), min: Array.min(measured, Order.Number)})
		})
	}
}

export const ToolHandlers = ToolContracts.toLayer(
	Effect.map(Fleet, fleet =>
		ToolContracts.of({
			create_exposure: Effect.fnUntraced(function* (input) {
				yield* checkWorker(listApps(yield* fleet.snapshot, {}), input.worker)
				return {
					url: yield* fleet.expose({
						...Struct.omit(input, ['worker']),
						...Boolean.match(input.worker === undefined, {onFalse: () => ({target: input.worker}), onTrue: () => ({})})
					})
				}
			}),
			list_apps: Effect.fnUntraced(function* (input) {
				const snapshot = yield* fleet.snapshot
				yield* checkWorker(listApps(snapshot, {}), input.worker)
				return inventoryPage(focusedInventory(listApps(snapshot, input), input.app), input)
			}),
			read_resource_history: Effect.fnUntraced(function* (input) {
				const value = yield* Effect.all(
					{machines: fleet.metrics({minutes: input.minutes}), snapshot: fleet.snapshot},
					{concurrency: 'unbounded'}
				)
				yield* checkWorker(listApps(value.snapshot, {}), input.worker)
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
				yield* checkWorker(listApps(yield* fleet.snapshot, {}), input.worker)
				yield* fleet.hide({
					name: input.name,
					...Boolean.match(input.worker === undefined, {onFalse: () => ({target: input.worker}), onTrue: () => ({})})
				})
				return input
			}),
			run_job: Effect.fnUntraced(function* (input) {
				const snapshot = yield* fleet.snapshot
				yield* checkWorker(listApps(snapshot, {}), input.worker)
				yield* fleet.run(yield* jobRequest(snapshot, input))
				return {started: true as const}
			})
		})
	)
)
