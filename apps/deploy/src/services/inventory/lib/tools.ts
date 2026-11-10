import {Array, Boolean, DateTime, Effect, Function, Number, Option, Order, Record, String, pipe} from 'effect'

import {
	appUsage,
	dot,
	itemOwner,
	type ProcessNode,
	processTree,
	type Row,
	status,
	workloadName,
	workloads
} from '#services/inventory/lib/utils.ts'
import {
	DeployError,
	type InventoryItem,
	type ListApp,
	type ListAppsInput,
	type ListExposure,
	type ListJob,
	type ProcessSummary,
	type RunJobInput,
	type RunRequest,
	type Snapshot
} from '#services/inventory/schema.ts'

function workerNames(snapshot: Snapshot) {
	return Array.dedupe([...(snapshot.workers ?? []), ...Array.map(snapshot.items, item => item.worker)])
}

function sourceWorker(source: {readonly name: string}, workers: readonly string[], local: string) {
	return Option.getOrElse(
		Array.findFirst(workers, worker => String.startsWith(`${worker} · `)(source.name)),
		() => local
	)
}

function errorsOf(
	sources: readonly {readonly error: string; readonly name: string}[],
	workers: readonly string[],
	worker: string
) {
	const local = Option.match(Array.head(workers), {onNone: () => '', onSome: Function.identity})
	return Array.map(
		Array.filter(sources, source => source.error !== '' && sourceWorker(source, workers, local) === worker),
		source => `${String.replace(`${worker} · `, '')(source.name)}: ${source.error}`
	)
}

function portsOf(row: Row) {
	return pipe(
		[...row.listeners, ...row.exposures],
		Array.filter(item => item.address !== 'container'),
		Array.map(item => Option.fromUndefinedOr(item.port)),
		Array.getSomes,
		Array.dedupe,
		Array.sort(Order.Number)
	)
}

function iso(milliseconds: number) {
	return DateTime.formatIso(DateTime.makeUnsafe(milliseconds))
}

function failureOf(item: InventoryItem) {
	if (dot(item, status(item)) === 'quiet') return {}
	return {
		failure: Option.match(Option.fromUndefinedOr(item.failure), {
			onNone: () => status(item),
			onSome: stop => stop.reason
		}),
		...Option.match(Option.fromUndefinedOr(item.failure?.at), {onNone: () => ({}), onSome: at => ({since: iso(at)})})
	}
}

function summaryOf(node: ProcessNode): ProcessSummary {
	return {
		...Boolean.match(Array.isReadonlyArrayNonEmpty(node.children), {
			onFalse: () => ({}),
			onTrue: () => ({children: Array.map(node.children, summaryOf)})
		}),
		...Record.getSomes({cpu: Option.map(Option.fromUndefinedOr(node.cpu), cpu => Number.round(cpu, 1))}),
		...Option.match(Option.filter(Option.fromUndefinedOr(node.label.detail), String.isNonEmpty), {
			onNone: () => ({}),
			onSome: detail => ({detail})
		}),
		mib: Number.round(node.memory / 1024 ** 2, 0),
		name: node.label.name
	}
}

function appOf(row: Row, withProcesses: boolean) {
	const ports = portsOf(row)
	const url = Option.map(Array.head(row.exposures), exposure => exposure.url)
	return {
		...failureOf(row.item),
		name: workloadName(row.item),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(ports), {onFalse: () => ({}), onTrue: () => ({ports})}),
		...Boolean.match(withProcesses && Array.isReadonlyArrayNonEmpty(row.item.processes ?? []), {
			onFalse: () => ({}),
			onTrue: () => ({processes: Array.map(processTree(row.item.processes ?? []), summaryOf)})
		}),
		state: row.item.state,
		...Record.getSomes({url})
	} satisfies ListApp
}

function jobOf(row: Row) {
	return {
		...failureOf(row.item),
		name: workloadName(row.item),
		...Record.getSomes({next: Option.map(Option.fromUndefinedOr(row.item.next), iso)})
	} satisfies ListJob
}

function exposureOf(item: InventoryItem) {
	return {
		access: Boolean.match(item.publicAccess === true, {
			onFalse: () => 'tailnet' as const,
			onTrue: () => 'public' as const
		}),
		...Record.getSomes({port: Option.fromUndefinedOr(item.port)}),
		url: item.url
	} satisfies ListExposure
}

function matches(row: Row, app: string) {
	const needle = String.toLowerCase(app)
	return Array.some([workloadName(row.item), row.item.name, row.item.unit ?? ''], name =>
		String.includes(needle)(String.toLowerCase(name))
	)
}

function rank(row: Row) {
	const light = dot(row.item, status(row.item))
	if (light === 'error') return 0
	if (light === 'warning') return 1
	return 2
}

const appOrder = Order.combine(
	Order.mapInput(Order.Number, rank),
	Order.mapInput(Order.flip(Order.Number), (row: Row) => appUsage(row.item.processes ?? []).memory)
)

const jobOrder = Order.combine(
	Order.mapInput(Order.Number, rank),
	Order.mapInput(Order.Number, (row: Row) => row.item.next ?? 0)
)

// The page's list per worker as compact JSON: its apps and scheduled jobs, the URLs it owns or can reach, and only the failures it would mark.
export function listApps(snapshot: Snapshot, input: ListAppsInput) {
	const app = Option.getOrUndefined(Option.filter(Option.fromUndefinedOr(input.app), String.isNonEmpty))
	const onlyFailing = input.failing === true
	return pipe(
		Array.filter(workerNames(snapshot), worker => input.worker === undefined || input.worker === worker),
		Array.map(worker => {
			const own = Array.filter(workloads(snapshot.items), row => row.item.worker === worker)
			const apps = pipe(
				Array.filter(
					own,
					row =>
						(row.item.kind === 'service' || row.item.kind === 'container') &&
						row.item.scheduled !== true &&
						(app === undefined || matches(row, app)) &&
						(!onlyFailing || dot(row.item, status(row.item)) !== 'quiet')
				),
				Array.sort(appOrder),
				Array.map(row => appOf(row, app !== undefined))
			)
			const jobs = pipe(
				Array.filter(
					own,
					row => row.item.scheduled === true && (!onlyFailing || dot(row.item, status(row.item)) !== 'quiet')
				),
				Array.sort(jobOrder),
				Array.map(row => jobOf(row))
			)
			const exposures = pipe(
				Array.filter(own, row => row.item.kind === 'exposure' && !onlyFailing),
				Array.map(row => exposureOf(row.item)),
				Array.sort(Order.mapInput(Order.String, (exposure: ListExposure) => exposure.url))
			)
			const errors = errorsOf(snapshot.sources, workerNames(snapshot), worker)
			return {
				apps,
				...Boolean.match(Array.isReadonlyArrayNonEmpty(errors), {onFalse: () => ({}), onTrue: () => ({errors})}),
				...Boolean.match(Array.isReadonlyArrayNonEmpty(exposures), {onFalse: () => ({}), onTrue: () => ({exposures})}),
				...Boolean.match(Array.isReadonlyArrayNonEmpty(jobs), {onFalse: () => ({}), onTrue: () => ({jobs})}),
				worker
			}
		})
	)
}

// Each app's history name, keyed the way its samples are: `service:<scope>:<unit>` or `container:<short id>`, named as the page's rows name it.
export function ownerNames(snapshot: Snapshot) {
	return Record.fromEntries(
		Array.map(
			workerNames(snapshot),
			worker =>
				[
					worker,
					Record.fromEntries(
						Array.flatMap(
							Array.filter(
								snapshot.items,
								(item: InventoryItem) =>
									item.worker === worker && (item.kind === 'service' || item.kind === 'container')
							),
							(item: InventoryItem) => [[itemOwner(item), workloadName(item)] as const]
						)
					)
				] as const
		)
	)
}

// The run request for a scheduled job the page shows, by its name or unit; both workers' jobs need a worker to choose.
export const jobRequest = Effect.fnUntraced(function* (snapshot: Snapshot, input: RunJobInput) {
	const matching = Array.filter(
		workloads(snapshot.items),
		row =>
			row.item.scheduled === true &&
			(input.worker === undefined || row.item.worker === input.worker) &&
			(workloadName(row.item) === input.job || row.item.name === input.job)
	)
	if (Array.isArrayEmpty(matching)) {
		return yield* DeployError.make({message: `No scheduled job named ${input.job}; list_apps shows the jobs.`})
	}
	if (matching.length > 1) {
		return yield* DeployError.make({message: `${input.job} runs on more than one worker; pass its worker.`})
	}
	const item = Option.getOrThrow(Array.head(matching)).item
	return {
		name: item.name,
		scope: item.scope ?? 'system',
		...Boolean.match(String.startsWith('remote:')(item.id), {
			onFalse: () => ({}),
			onTrue: () => ({target: item.worker})
		})
	} satisfies RunRequest
})
