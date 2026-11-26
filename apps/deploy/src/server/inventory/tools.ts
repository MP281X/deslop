import {Array, Effect, HashSet, Option, Order, Schema, String, Struct, pipe} from 'effect'

import {Tool, Toolkit} from 'effect/ai'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, CurrentUser} from '@deslop/runtime/shared/auth'

import {DeployError} from '#contracts'

import {jobRequest, listApps} from '#server/inventory/lib/inventory.ts'
import {AppList, InventoryCursor, InventoryQuery, ManagedApp, RunJobInput} from '#server/inventory/schema.ts'
import type {ProcessSummary} from '#server/inventory/schema.ts'
import {Inventory} from '#server/inventory/service.ts'
import {Machine} from '#server/machine/service.ts'

type PageLimit = typeof PageLimit.Type
const PageLimit = pipe(
	Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
	Schema.withDecodingDefaultTypeKey(Effect.succeed(30))
)

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

export const inventoryTools = Toolkit.make(
	Tool.make('list_apps', {
		description:
			'Inspect the apps, jobs and owned HTTPS exposures on the machine Deploy runs on; app focuses on matching names and includes process trees. Continue with nextCursor; processOffset pages a focused app’s tree, retaining ancestors of selected nodes.',
		failure: DeployError,
		parameters: Schema.Struct({
			...InventoryQuery.fields,
			cursor: Schema.OptionFromOptionalKey(InventoryCursor),
			limit: PageLimit,
			processLimit: PageLimit,
			processOffset: pipe(Schema.Natural, Schema.withDecodingDefaultTypeKey(Effect.succeed(0)))
		}),
		success: AppList.mapFields(fields => ({
			...fields,
			apps: Schema.Array(
				Schema.Struct({
					...ManagedApp.fields,
					nextProcessOffset: Schema.OptionFromOptionalKey(Schema.Natural),
					processesOmitted: Schema.OptionFromOptionalKey(Schema.Natural)
				})
			),
			nextCursor: Schema.OptionFromOptionalKey(InventoryCursor)
		}))
	})
		.annotate(Tool.Readonly, true)
		.annotate(Tool.Strict, true),
	Tool.make('run_job', {
		dependencies: [CurrentUser],
		description:
			'Start a scheduled job now by its id from list_apps. started means accepted, not completed; inspect list_apps or Scope for the outcome.',
		failure: Schema.Union([AuthError, DeployError]),
		parameters: RunJobInput,
		success: Schema.Struct({started: Schema.Literal(true)})
	}).annotate(Tool.Strict, true)
)

export const inventoryToolHandlers = inventoryTools.toLayer(
	Effect.gen(function* () {
		const machine = yield* Machine
		const inventory = yield* Inventory
		return inventoryTools.of({
			list_apps: Effect.fnUntraced(function* (input) {
				return inventoryPage(focusedInventory(listApps(yield* machine.snapshot, input), input.app), input)
			}),
			run_job: Effect.fnUntraced(function* (input) {
				const admin = yield* requireAdmin(yield* CurrentUser, 'Only an admin can run jobs')
				yield* inventory.run(yield* jobRequest(yield* machine.snapshot, input), admin)
				return {started: true as const}
			})
		})
	})
)
