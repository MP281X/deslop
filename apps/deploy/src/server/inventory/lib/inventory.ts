import {Array, Boolean, DateTime, Effect, Filter, Function, Number, Option, Order, Record, String, pipe} from 'effect'

import {
	AppId,
	DeployError,
	ExposureName,
	healthRank,
	important,
	ipv4Reachable,
	itemOwner,
	processTree,
	requestOf,
	rowUsageOrder,
	workloadName,
	workloads
} from '#contracts'
import type {InventoryItem, Process, ProcessNode, Row, Snapshot} from '#contracts'

import {JobName} from '#server/inventory/schema.ts'
import type {
	AppList,
	InventoryQuery,
	HttpsExposure,
	Job,
	ManagedApp,
	ProcessSummary,
	RunJobInput
} from '#server/inventory/schema.ts'

// The service or container a process or cgroup belongs to: `service:<scope>:<unit>` or `container:<short id>`. Under a user manager, `app-<name>.slice` holds what `<name>.service` started outside its own cgroup, like T3 Code's agents.
export function processOwner(cgroup: string) {
	const container = pipe(
		cgroup,
		String.match(/\/(?:docker-|docker\/)([a-f0-9]{12,64})(?:\.scope)?(?:\/|\n|$)/u),
		Option.flatMap(match => Array.get(match, 1))
	)
	if (Option.isSome(container)) return Option.map(container, id => AppId.make(`container:${String.slice(0, 12)(id)}`))
	const segments = String.split(cgroup, /[/\n]/u)
	const service = Array.findLastIndex(segments, String.endsWith('.service'))
	const userService = Array.findFirstIndex(segments, segment =>
		Option.isSome(String.match(/^user@[0-9]+\.service$/u)(segment))
	)
	return pipe(
		userService,
		Option.filter(index => !Option.exists(service, last => last > index)),
		Option.flatMap(index =>
			pipe(
				segments,
				Array.drop(index + 1),
				Array.findFirst(segment => String.match(/^app-(.+)\.slice$/u)(segment))
			)
		),
		Option.map(match => AppId.make(`service:user:${match[1]}.service`)),
		Option.orElse(() =>
			Option.map(service, index =>
				AppId.make(
					`service:${pipe(
						userService,
						Option.exists(first => index > first),
						Boolean.match({onFalse: Function.constant('system'), onTrue: Function.constant('user')})
					)}:${segments[index]}`
				)
			)
		)
	)
}

// Who a loopback proxy to `port` reaches: the containers that publish it, else each listener's unit or process, joined; none when nothing listens.
export function portOwner(items: Snapshot['items'], port: number) {
	const containers = Array.flatMap(items, item => {
		if (item.kind !== 'container') return []
		return pipe(
			Array.flatten(Option.toArray(item.bindings)),
			Array.filter(binding => binding.protocol === 'tcp' && binding.port === port && ipv4Reachable(binding.address)),
			Array.map(() => `container:${item.name}`)
		)
	})
	return pipe(
		Array.match(containers, {
			onEmpty: () =>
				Array.flatMap(items, item => {
					if (
						item.kind !== 'port' ||
						!Option.contains(item.port, port) ||
						!Option.contains(item.protocol, 'tcp') ||
						!Option.exists(item.address, ipv4Reachable)
					) {
						return []
					}
					return [
						Option.match(item.unit, {
							onNone: () => `process:${Option.getOrElse(item.process, Function.constant('unknown'))}`,
							onSome: unit => `${Option.getOrElse(item.scope, Function.constant('system'))}:${unit}`
						})
					]
				}),
			onNonEmpty: Function.identity
		}),
		Array.dedupe,
		Array.sort(Order.String),
		Array.match({onEmpty: Option.none, onNonEmpty: owners => Option.some(Array.join(owners, ' + '))})
	)
}

function status(item: InventoryItem) {
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && Option.contains(item.owned, true)) return 'configured'
	if (item.kind === 'exposure' && Option.contains(item.publicAccess, true)) return 'public permission'
	return item.state
}

export function attachProcesses(
	items: readonly InventoryItem[],
	records: readonly {owner: Option.Option<AppId>; process: Process}[]
) {
	const owners = Array.groupBy(
		Array.getSomes(Array.map(records, record => Option.map(record.owner, owner => ({owner, process: record.process})))),
		record => record.owner
	)
	return Array.map(items, item => ({
		...item,
		processes: Option.some(
			pipe(
				item.kind === 'service' || item.kind === 'container',
				Boolean.match({onFalse: () => [], onTrue: () => owners[itemOwner(item)] ?? []}),
				Array.map(record => record.process)
			)
		)
	}))
}

function errorsOf(sources: readonly {readonly error: Option.Option<string>; readonly name: string}[]) {
	return Array.filterMap(
		sources,
		Filter.fromPredicateOption(source => Option.map(source.error, error => `${source.name}: ${error}`))
	)
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

function failureOf(item: InventoryItem) {
	if (item.health === 'quiet') return {failure: Option.none<string>(), since: Option.none<DateTime.Utc>()}
	return {
		failure: Option.some(Option.match(item.failure, {onNone: () => status(item), onSome: stop => stop.reason})),
		since: Option.flatMap(item.failure, failure => failure.at)
	}
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
export function listApps(snapshot: Snapshot, input: InventoryQuery) {
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

// Each app's history name, keyed the way its samples are: `service:<scope>:<unit>` or `container:<short id>`, named as the page's rows name it.
export function ownerNames(snapshot: Snapshot) {
	return pipe(
		snapshot.items,
		Array.filter(item => item.kind === 'service' || item.kind === 'container'),
		Record.fromIterableWith((item: InventoryItem) => [itemOwner(item), workloadName(item)] as const)
	)
}

// The run request for a scheduled job the page shows, by its id: names repeat across scopes and units.
export const jobRequest = Effect.fnUntraced(function* (snapshot: Snapshot, input: RunJobInput) {
	return yield* pipe(
		workloads(snapshot.items),
		Array.findFirst(row => Option.contains(row.item.scheduled, true) && row.item.id === input.id),
		Option.match({
			onNone: () =>
				Effect.fail(DeployError.make({message: `No scheduled job has the id ${input.id}; list_apps shows the jobs.`})),
			onSome: row => Effect.succeed(requestOf(row.item))
		})
	)
})
