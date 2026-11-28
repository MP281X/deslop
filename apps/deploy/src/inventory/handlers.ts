import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Effect,
	Filter,
	Function,
	HashSet,
	Number,
	Option,
	Order,
	Schedule,
	Schema,
	Stream,
	String,
	Struct,
	pipe
} from 'effect'

import {Tool, Toolkit} from 'effect/ai'
import {Reactivity} from 'effect/reactivity'

import {requireAdmin} from '@deslop/runtime/server/auth'
import {AuthError, CurrentAdmin, CurrentUser} from '@deslop/runtime/shared/auth'

import {
	AppList,
	ExposureName,
	InventoryCursor,
	InventoryQuery,
	InventoryRpcs,
	JobName,
	ManagedApp,
	RunJobInput
} from './contract.ts'
import type {HttpsExposure, InventoryItem, Job, ProcessSummary, Snapshot} from './contract.ts'
import {Inventory, jobRequest} from './server.ts'
import {healthRank, important, processTree, rowUsageOrder, workloadName, workloads} from './workloads.ts'
import type {ProcessNode, Row} from './workloads.ts'

import {DeployError} from '#machine/contract.ts'
import {Machine} from '#machine/server.ts'

type PageLimit = typeof PageLimit.Type
const PageLimit = pipe(
	Schema.Int.check(Schema.isBetween({maximum: 100, minimum: 1})),
	Schema.withDecodingDefaultTypeKey(Effect.succeed(30))
)

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

function errorsOf(sources: readonly {readonly error: Option.Option<string>; readonly name: string}[]) {
	return Array.filterMap(
		sources,
		Filter.fromPredicateOption(source => Option.map(source.error, error => `${source.name}: ${error}`))
	)
}

function status(item: InventoryItem) {
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && Option.contains(item.owned, true)) return 'configured'
	if (item.kind === 'exposure' && Option.contains(item.publicAccess, true)) return 'public permission'
	return item.state
}

function failureOf(item: InventoryItem) {
	if (item.health === 'quiet') return {failure: Option.none<string>(), since: Option.none<DateTime.Utc>()}
	return {
		failure: Option.some(Option.match(item.failure, {onNone: () => status(item), onSome: stop => stop.reason})),
		since: Option.flatMap(item.failure, failure => failure.at)
	}
}

function portsOf(row: Row) {
	return pipe(
		[...row.listeners, ...row.exposures],
		Array.filter(item => !Option.contains(item.address, 'container')),
		Array.map(item => item.port),
		Array.getSomes,
		Array.dedupe,
		Array.sort(Order.Number)
	)
}

function summaryOf(node: ProcessNode): ProcessSummary {
	return {
		children: pipe(
			node.children,
			Option.liftPredicate(Array.isReadonlyArrayNonEmpty),
			Option.map(children => Array.map(children, summaryOf))
		),
		cpu: Option.map(node.cpu, cpu => Number.round(cpu, 1)),
		detail: Option.liftPredicate(node.label.detail, String.isNonEmpty),
		mib: Number.round(node.memory / 1024 ** 2, 0),
		name: node.label.name
	}
}

function appOf(row: Row, withProcesses: boolean) {
	const reachable = portsOf(row)
	const url = Option.flatMap(Array.head(row.exposures), exposure => exposure.url)
	return {
		...failureOf(row.item),
		id: row.item.id,
		name: workloadName(row.item),
		ports: Option.liftPredicate(reachable, Array.isReadonlyArrayNonEmpty),
		processes: pipe(
			row.item.processes,
			Option.filter(processes => withProcesses && Array.isReadonlyArrayNonEmpty(processes)),
			Option.map(processes => Array.map(processTree(processes), summaryOf))
		),
		state: row.item.state,
		url
	} satisfies ManagedApp
}

function matches(row: Row, app: string) {
	const needle = String.toLowerCase(app)
	return Array.some([workloadName(row.item), row.item.name, ...Option.toArray(row.item.unit)], name =>
		String.includes(needle)(String.toLowerCase(name))
	)
}

const appOrder = pipe(Order.Number, Order.mapInput(healthRank), Order.combine(rowUsageOrder))

const jobOrder = pipe(
	Order.Number,
	Order.mapInput(healthRank),
	Order.combine(Order.mapInput(Option.makeOrder(DateTime.Order), (row: Row) => row.item.next))
)

// The page's list as compact JSON: its apps and scheduled jobs, the URLs it owns or can reach, and only the failures it would mark.
function listApps(snapshot: Snapshot, input: InventoryQuery) {
	const app = Option.filter(input.app, String.isNonEmpty)
	const onlyFailing = Option.contains(input.failing, true)
	const rows = workloads(snapshot.items)
	const apps = pipe(
		Array.filter(
			rows,
			row =>
				(row.item.kind === 'service' || row.item.kind === 'container') &&
				!Option.contains(row.item.scheduled, true) &&
				!Option.exists(app, query => !matches(row, query)) &&
				(!onlyFailing || row.item.health !== 'quiet')
		),
		Array.sort(appOrder),
		Array.map(row => appOf(row, Option.isSome(app)))
	)
	const jobs = pipe(
		Array.filter(
			rows,
			row => Option.contains(row.item.scheduled, true) && (!onlyFailing || row.item.health !== 'quiet')
		),
		Array.sort(jobOrder),
		Array.map(
			row =>
				({
					...failureOf(row.item),
					id: row.item.id,
					name: JobName.make(workloadName(row.item)),
					next: row.item.next,
					running: row.item.running
				}) satisfies Job
		)
	)
	// Every exposure the machine owns or opens to the public, whether or not an app row shows it, so remove_exposure can find it by name.
	const exposures = pipe(
		snapshot.items,
		Array.flatMap(item => {
			if (item.kind !== 'exposure' || (onlyFailing && item.health === 'quiet') || !important(item)) return []
			return Option.toArray(
				Option.map(
					item.url,
					url =>
						({
							access: pipe(
								item.publicAccess,
								Option.contains(true),
								Boolean.match({
									onFalse: Function.constant('tailnet' as const),
									onTrue: Function.constant('public' as const)
								})
							),
							failure: failureOf(item).failure,
							id: item.id,
							name: ExposureName.make(item.name),
							port: item.port,
							url
						}) satisfies HttpsExposure
				)
			)
		}),
		Array.sort(Order.mapInput(Order.String, (exposure: HttpsExposure) => exposure.url))
	)
	return {
		apps,
		errors: Option.liftPredicate(errorsOf(snapshot.sources), Array.isReadonlyArrayNonEmpty),
		exposures: Option.liftPredicate(exposures, Array.isReadonlyArrayNonEmpty),
		jobs: Option.liftPredicate(jobs, Array.isReadonlyArrayNonEmpty)
	} satisfies AppList
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

export const inventoryToolHandlers = inventoryTools.toLayer(
	Effect.gen(function* () {
		const machine = yield* Machine
		const inventory = yield* Inventory
		return inventoryTools.of({
			// One page of the list: the apps, jobs and exposures after the cursor, focused on the matching app when one is named.
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

export const inventoryHandlers = InventoryRpcs.toLayer(
	Effect.gen(function* () {
		const inventory = yield* Inventory
		const machine = yield* Machine
		// Viewers share one inventory, read every five seconds and again after each change.
		const view = yield* pipe(
			Stream.fromEffect(machine.view),
			Stream.concat(
				Stream.mergeAll(
					[
						Stream.fromEffectSchedule(
							Effect.andThen(inventory.ensureFresh, machine.view),
							Schedule.spaced(Duration.seconds(5))
						),
						pipe(
							Reactivity.stream(Effect.void, ['deployInventory']),
							Stream.drop(1),
							Stream.mapEffect(() => machine.view)
						)
					],
					{concurrency: 'unbounded'}
				)
			),
			Stream.share({capacity: 1, replay: 1, strategy: 'sliding'})
		)
		return InventoryRpcs.of({
			'inventory.logs': input => Effect.flatMap(CurrentAdmin, admin => inventory.logs(input, admin)),
			'inventory.restart': input => Effect.flatMap(CurrentAdmin, admin => inventory.restart(input, admin)),
			'inventory.run': input => Effect.flatMap(CurrentAdmin, admin => inventory.run(input, admin)),
			'inventory.stop': input => Effect.flatMap(CurrentAdmin, admin => inventory.stop(input, admin)),
			'inventory.watch': () => view
		})
	})
)
