import {Array, Effect, HashSet, Option, Order, String, Struct, pipe} from 'effect'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {CurrentUser} from '@deslop/runtime/shared/auth'

import {jobRequest, listApps, ownerNames} from '#services/inventory/lib/utils.ts'
import type {AppList, InventoryCursor, ProcessSummary} from '#services/inventory/schema.ts'
import {Machine} from '#services/machine/service.ts'
import {resourceHistory} from '#services/metrics/lib/utils.ts'
import {Metrics} from '#services/metrics/service.ts'
import {ToolContracts} from '#tools/contracts.ts'

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

const cursorOrder: Order.Order<InventoryCursor> = Order.Tuple([Order.String, Order.String])

function inventoryPage(
	list: AppList,
	input: {cursor: Option.Option<InventoryCursor>; limit: number; processLimit: number; processOffset: number}
) {
	const remaining = pipe(
		[
			...Array.map(list.apps, row => ['apps', row.id] satisfies InventoryCursor),
			...pipe(
				list.jobs,
				Option.getOrElse(Array.empty),
				Array.map(row => ['jobs', row.id] satisfies InventoryCursor)
			),
			...pipe(
				list.exposures,
				Option.getOrElse(Array.empty),
				Array.map(row => ['exposures', row.id] satisfies InventoryCursor)
			)
		],
		Array.sort(cursorOrder),
		Array.filter(key => !Option.exists(input.cursor, cursor => Order.isLessThanOrEqualTo(cursorOrder)(key, cursor)))
	)
	const page = Array.take(remaining, input.limit)
	const selected = HashSet.fromIterable(page)
	return {
		apps: pipe(
			list.apps,
			Array.filter(row => HashSet.has(selected, ['apps', row.id])),
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
		errors: list.errors,
		exposures: Option.map(list.exposures, exposures =>
			Array.filter(exposures, row => HashSet.has(selected, ['exposures', row.id]))
		),
		jobs: Option.map(list.jobs, jobs => Array.filter(jobs, row => HashSet.has(selected, ['jobs', row.id]))),
		nextCursor: pipe(
			page,
			Array.last,
			Option.filter(() => remaining.length > input.limit)
		)
	}
}

function focusedInventory(list: AppList, app: Option.Option<string>) {
	return Option.match(app, {
		onNone: () => list,
		onSome: queryText => {
			const query = String.toLowerCase(queryText)
			function matchingName(row: {readonly name: string}) {
				return pipe(row.name, String.toLowerCase, String.includes(query))
			}
			return {
				...list,
				exposures: pipe(
					list.exposures,
					Option.map(rows => Array.filter(rows, matchingName)),
					Option.orElseSome(() => [])
				),
				jobs: pipe(
					list.jobs,
					Option.map(rows => Array.filter(rows, matchingName)),
					Option.orElseSome(() => [])
				)
			}
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
	Effect.gen(function* () {
		const machine = yield* Machine
		const metrics = yield* Metrics
		return ToolContracts.of({
			create_exposure: Effect.fnUntraced(function* (input) {
				return {
					url: yield* machine.expose(
						input,
						yield* requireAdmin(yield* CurrentUser, 'Only an admin can create exposures')
					)
				}
			}),
			list_apps: Effect.fnUntraced(function* (input) {
				return inventoryPage(focusedInventory(listApps(yield* machine.snapshot, input), input.app), input)
			}),
			read_resource_history: Effect.fnUntraced(function* (input) {
				const value = yield* Effect.all(
					{history: metrics.read({minutes: input.minutes}), snapshot: machine.snapshot},
					{concurrency: 'unbounded'}
				)
				const history = resourceHistory(value.history, input.minutes, ownerNames(value.snapshot))
				return {
					...history,
					cpuPct: metricSummary(history.cpuPct),
					diskPct: metricSummary(history.diskPct),
					memoryPct: metricSummary(history.memoryPct),
					series: pipe(
						history,
						Struct.pick(['cpuPct', 'diskPct', 'memoryPct']),
						Option.liftPredicate(() => input.series)
					)
				}
			}),
			remove_exposure: Effect.fnUntraced(function* (input) {
				yield* machine.hide(input, yield* requireAdmin(yield* CurrentUser, 'Only an admin can remove exposures'))
				return input
			}),
			run_job: Effect.fnUntraced(function* (input) {
				const admin = yield* requireAdmin(yield* CurrentUser, 'Only an admin can run jobs')
				yield* machine.run(yield* jobRequest(yield* machine.snapshot, input), admin)
				return {started: true as const}
			})
		})
	})
)
