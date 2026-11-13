import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Effect,
	Equal,
	Function,
	HashMap,
	HashSet,
	MutableHashSet,
	Number,
	Option,
	Order,
	Record,
	String,
	Tuple,
	pipe
} from 'effect'

import {AppId, DeployError, ExposureName, ItemId, JobName, UnitId} from '#services/inventory/schema.ts'
import type {
	InventoryItem,
	SocketAddress,
	SocketBinding,
	App,
	InventoryQuery,
	HttpsExposure,
	Job,
	Process,
	ProcessLabel,
	ProcessId,
	ProcessSummary,
	RunJobInput,
	RunRequest,
	Snapshot,
	WorkerId
} from '#services/inventory/schema.ts'

// A remote source prefixes its worker and a local one names its own collector, so a bare worker name is that worker's.
export function sourceBelongsToWorker(source: {readonly name: string}, worker: WorkerId) {
	return source.name === worker || String.startsWith(`${worker} · `)(source.name)
}

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
						Boolean.match({onFalse: () => 'system', onTrue: () => 'user'})
					)}:${segments[index]}`
				)
			)
		)
	)
}

// A loopback proxy can only reach these TCP listeners, not a tailnet-interface-only socket or UDP.
function loopbackPort(item: InventoryItem) {
	return (
		item.kind === 'port' &&
		Option.contains(item.protocol, 'tcp') &&
		Option.exists(item.port, port => port >= 1024) &&
		Option.exists(item.address, address => Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(address)))
	)
}

function appPort(item: InventoryItem) {
	return (
		loopbackPort(item) &&
		Option.isSome(item.process) &&
		!Option.exists(item.port, port => Array.contains([5353, 5355], port)) &&
		!Option.exists(item.process, process =>
			Option.isSome(String.match(/^(?:ssh|cloudflared|tailscaled|caddy|ControlCenter)$/u)(process))
		)
	)
}

function important(item: InventoryItem) {
	if (item.health === 'error') return true
	if (item.kind === 'exposure') return Option.contains(item.owned, true) || Option.contains(item.publicAccess, true)
	if (item.kind === 'container') {
		return item.active
	}
	if (item.kind === 'port') return appPort(item)
	if (item.kind !== 'service') return false
	if (Option.isSome(String.match(/^(?:deslop-|preview-|t3code)/u)(item.name))) return true
	return (
		Option.contains(item.scope, 'user') &&
		item.active &&
		Option.isNone(
			String.match(/^(?:dbus|dirmngr|gpg-|keyboxd|gcr-|gnome-|secret-service|ssh-agent|openvpn3-)/u)(item.name)
		)
	)
}

function ports(items: readonly InventoryItem[]) {
	return pipe(
		items,
		Array.filter(item => appPort(item) && Option.contains(item.http, true)),
		Array.sort(
			Order.mapInput(
				Order.String,
				(item: InventoryItem) =>
					`${item.worker}:${Option.getOrUndefined(item.port)}:${Option.getOrUndefined(item.address)}`
			)
		),
		Array.dedupeWith(
			(a, b) => a.worker === b.worker && Option.makeEquivalence<number>((x, y) => x === y)(a.port, b.port)
		)
	)
}

export function itemOwner(item: InventoryItem) {
	if (item.kind === 'container') {
		return AppId.make(
			`container:${String.slice(0, 12)(Option.getOrElse(Array.last(String.split(item.id, ':docker:')), () => ''))}`
		)
	}
	return AppId.make(`service:${Option.getOrElse(item.scope, () => 'system')}:${item.name}`)
}

function fullName(item: InventoryItem) {
	if (item.kind === 'port') return Option.getOrElse(item.process, () => item.name)
	if (item.kind === 'container' && String.startsWith('deslop-')(item.name)) {
		return String.replace(/-[0-9]+$/u, '')(String.slice(7)(item.name))
	}
	if (String.startsWith('preview-')(item.name)) {
		return Option.match(String.match(/@deslop\/([a-z0-9-]+)/u)(item.detail), {
			onNone: () => `Preview ${String.replace(/\.service$/u, '')(String.slice(8)(item.name))}`,
			onSome: app => `${app[1]} preview`
		})
	}
	return String.replaceAll(/^deslop-|\.service$/gu, '')(item.name)
}

export function workloadName(item: InventoryItem) {
	return pipe(
		fullName(item),
		String.replaceAll(/\b([a-f0-9]{7})[a-f0-9]+\b/giu, '$1'),
		String.replaceAll(/\b(?=[a-z0-9]{10,}\b)(?=[a-z0-9]*[0-9])([a-z0-9]{7})[a-z0-9]+\b/giu, '$1')
	)
}

function sameSocket(listener: InventoryItem, binding: SocketBinding) {
	if (Option.contains(listener.address, 'container') || binding.address === 'container') return false
	if (!Option.contains(listener.port, binding.port) || !Option.contains(listener.protocol, binding.protocol)) {
		return false
	}
	if (Option.contains(listener.address, binding.address)) return true
	return (
		Option.exists(listener.address, address =>
			Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(address))
		) && Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(binding.address))
	)
}

function socket(worker: WorkerId, binding: SocketAddress) {
	const loopback = Option.exists(binding.address, address =>
		Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(address))
	)
	return Tuple.make(
		worker,
		binding.protocol,
		binding.port,
		loopback,
		Boolean.match(loopback, {onFalse: () => binding.address, onTrue: () => Option.some('')})
	)
}

export function workloads(items: readonly InventoryItem[]) {
	const listeners = Array.filter(items, item => item.kind === 'port')
	const byUnit = pipe(
		listeners,
		Array.groupBy(listener => listener.worker),
		Record.map(worker =>
			Array.groupBy(worker, listener =>
				Option.match(listener.unit, {onNone: () => 'none', onSome: unit => `unit:${unit}`})
			)
		)
	)
	const bySocket = HashMap.fromIterable(
		Array.map(
			Array.reverse(Array.filter(listeners, listener => !Option.contains(listener.address, 'container'))),
			listener => [socket(listener.worker, listener), listener] as const
		)
	)
	const grouped = pipe(
		items,
		Array.filter(item => item.kind === 'service' || item.kind === 'container'),
		Array.map(item => {
			const attached = Array.filter(byUnit[item.worker]?.[`unit:${item.name}`] ?? [], listener =>
				Option.exists(listener.unit, unit => unit === item.name)
			)
			const bindings = pipe(
				item.bindings,
				Option.getOrElse(Array.empty),
				Array.map(binding => ({
					...item,
					...pipe(
						HashMap.get(
							bySocket,
							socket(item.worker, {
								address: Option.some(binding.address),
								port: Option.some(binding.port),
								protocol: Option.some(binding.protocol)
							})
						),
						Option.filter(() => binding.address !== 'container'),
						Option.getOrElse(() => ({}))
					),
					address: Option.some(binding.address),
					bindings: Option.some([]),
					id: ItemId.make(`${item.id}:port:${binding.address}`),
					kind: 'port' as const,
					port: Option.some(binding.port),
					process: Option.some(item.name),
					protocol: Option.some(binding.protocol),
					unit: pipe(
						item,
						Option.liftPredicate(owner => owner.kind === 'service'),
						Option.map(owner => owner.name)
					),
					url: Option.none<string>()
				}))
			)
			return {item, listeners: [...attached, ...bindings]}
		})
	)
	const services = HashSet.fromIterable(
		pipe(
			grouped,
			Array.filter(row => row.item.kind === 'service'),
			Array.map(row => Tuple.make(row.item.worker, row.item.name))
		)
	)
	const represented = HashSet.fromIterable(
		Array.flatMap(grouped, row =>
			pipe(
				row.listeners,
				Array.filter(binding => !Option.contains(binding.address, 'container')),
				Array.map(binding =>
					socket(row.item.worker, {address: binding.address, port: binding.port, protocol: binding.protocol})
				)
			)
		)
	)
	const loose = Array.filter(
		listeners,
		listener =>
			!Option.exists(listener.unit, unit => HashSet.has(services, Tuple.make(listener.worker, unit))) &&
			(Option.contains(listener.address, 'container') || !HashSet.has(represented, socket(listener.worker, listener)))
	)
	const rows = [...grouped, ...Array.map(loose, item => ({item, listeners: [item]}))]
	const exposures = [
		...Array.filter(items, item => item.kind === 'exposure' && Option.contains(item.owned, true)),
		...Array.filter(items, item => item.kind === 'exposure' && !Option.contains(item.owned, true))
	]
	const exposuresBySocket = pipe(
		exposures,
		Array.map((item, index) => ({index, item})),
		Array.groupBy(entry => `${entry.item.worker}:${Option.getOrElse(entry.item.port, () => 0)}`)
	)
	const linked = Array.map(rows, row => {
		const reachable = Array.dedupe(
			pipe(
				row.listeners,
				Array.filter(listener =>
					Option.exists(listener.port, port =>
						sameSocket(listener, {address: `127.0.0.1:${port}`, port, protocol: 'tcp'})
					)
				),
				Array.map(listener => listener.port),
				Array.getSomes
			)
		)
		const exposed = pipe(
			Array.flatMap(reachable, port => exposuresBySocket[`${row.item.worker}:${port}`] ?? []),
			Array.sortWith(entry => entry.index, Order.Number),
			Array.map(entry => entry.item)
		)
		return {
			...row,
			exposures: Array.dedupeWith(
				[
					...pipe(
						row.item.links,
						Option.getOrElse(Array.empty),
						Array.map(url => ({
							...row.item,
							id: ItemId.make(`${row.item.id}:url:${url}`),
							kind: 'exposure' as const,
							name: ExposureName.make(row.item.name),
							owned: Option.some(false),
							publicAccess: Option.some(true),
							url: Option.some(url)
						}))
					),
					...exposed
				],
				(a: InventoryItem, b: InventoryItem) => Equal.equals(a.url, b.url)
			)
		}
	})
	const linkedIds = HashSet.fromIterable(
		Array.flatMap(linked, row => Array.map(row.exposures, exposure => exposure.id))
	)
	const linkedUrls = HashSet.fromIterable(
		Array.flatMap(linked, row => Array.map(row.exposures, exposure => Tuple.make(exposure.worker, exposure.url)))
	)
	const remaining = pipe(
		exposures,
		Array.filter(
			item => !HashSet.has(linkedIds, item.id) && !HashSet.has(linkedUrls, Tuple.make(item.worker, item.url))
		),
		Array.map(item => ({exposures: [item], item, listeners: []}))
	)
	return pipe(
		[...linked, ...remaining],
		Array.filter(
			row =>
				important(row.item) &&
				(row.item.kind !== 'port' ||
					(Option.contains(row.item.http, true) &&
						Option.isSome(row.item.process) &&
						!Option.contains(row.item.process, 'node')))
		),
		Array.map(row => {
			if (row.item.kind === 'container') return row
			const candidates = ports(row.listeners)
			const hasUi = Array.some(candidates, candidate => Option.contains(candidate.ui, true))
			const exposedPorts = HashSet.fromIterable(Array.getSomes(Array.map(row.exposures, exposure => exposure.port)))
			return {
				...row,
				listeners: Array.filter(
					candidates,
					listener =>
						!hasUi ||
						Option.contains(listener.ui, true) ||
						Option.exists(listener.port, port => HashSet.has(exposedPorts, port))
				)
			}
		})
	)
}

export type Row = ReturnType<typeof workloads>[number]

export function availablePorts(rows: ReturnType<typeof workloads>) {
	return ports(
		Array.flatMap(rows, row =>
			pipe(
				row.listeners,
				Array.filter(
					listener =>
						(!Array.some(row.listeners, candidate => Option.contains(candidate.ui, true)) ||
							Option.contains(listener.ui, true)) &&
						!Option.exists(row.item.links, Array.isReadonlyArrayNonEmpty) &&
						!Array.some(row.exposures, exposure =>
							Option.makeEquivalence<number>((x, y) => x === y)(exposure.port, listener.port)
						)
				),
				Array.map(listener => ({...listener, process: Option.some(workloadName(row.item))}))
			)
		)
	)
}

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})

export function status(item: InventoryItem) {
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && Option.contains(item.owned, true)) return 'configured'
	if (item.kind === 'exposure' && Option.contains(item.publicAccess, true)) return 'public permission'
	return item.state
}

// How long ago a service stopped: minutes within the hour, hours within two days, then days.
function since(at: DateTime.Utc, now: DateTime.Utc) {
	const minutes = Number.max(0, Number.round(Duration.toMinutes(DateTime.distance(at, now)), 0))
	if (minutes < 60) return untilNext.format(-minutes, 'minute')
	if (minutes < 2880) return untilNext.format(-Number.round(minutes / 60, 0), 'hour')
	return untilNext.format(-Number.round(minutes / 1440, 0), 'day')
}

// When a timer next starts the job, against the snapshot's clock: minutes within the hour, then hours.
export function nextRun(next: DateTime.Utc, now: DateTime.Utc) {
	const minutes = Number.max(0, Number.round(Duration.toMinutes(DateTime.distance(now, next)), 0))
	if (minutes < 60) return untilNext.format(minutes, 'minute')
	return untilNext.format(Number.round(minutes / 60, 0), 'hour')
}

// Why an app needs a look: the failure systemd recorded, else what its detail says.
export function reasonOf(item: InventoryItem) {
	return Option.match(item.failure, {onNone: () => item.detail, onSome: stop => stop.reason})
}

export function failureAge(item: InventoryItem, now: DateTime.Utc) {
	return pipe(
		item.failure,
		Option.flatMap(stop => stop.at),
		Option.map(at => since(at, now))
	)
}

export function reasonLine(item: InventoryItem, now: DateTime.Utc) {
	return Option.match(failureAge(item, now), {
		onNone: () => reasonOf(item),
		onSome: age => `${reasonOf(item)} · ${age}`
	})
}

// A process with everything below it: `memory` and `cpu` cover the subtree; `cpu` stays unknown while no member reports one.
export type ProcessNode = {
	children: readonly ProcessNode[]
	command: Option.Option<readonly string[]>
	cpu: Option.Option<number>
	label: ProcessLabel
	memory: number
	pid: ProcessId
	small: boolean
}

function usage(nodes: readonly ProcessNode[]) {
	return {
		cpu: pipe(
			nodes,
			Array.map(node => node.cpu),
			Array.getSomes,
			Array.match({onEmpty: () => Option.none(), onNonEmpty: values => Option.some(Number.sumAll(values))})
		),
		memory: Number.sumAll(Array.map(nodes, node => node.memory))
	}
}

const byUsage = pipe(
	Order.flip(Order.Number),
	Order.mapInput((node: ProcessNode) => node.memory),
	Order.combine(Order.mapInput(Option.makeOrder(Order.flip(Order.Number)), (node: ProcessNode) => node.cpu))
)

// Children heaviest first; below 2% of the app's memory and half a percent of the machine's CPU a process barely moves the usage, so it reads muted.
function settle(children: readonly ProcessNode[], appMemory: number) {
	return pipe(
		children,
		Array.sort(byUsage),
		Array.map(node => ({...node, small: node.memory < appMemory * 0.02 && !Option.exists(node.cpu, cpu => cpu >= 0.5)}))
	)
}

function sameLabel(first: ProcessLabel, second: ProcessLabel) {
	return first.name === second.name && first.detail === second.detail
}

// A child that says the same thing as its parent is the same row: hide it, keep its descendants, and leave its usage in the parent's total.
function absorb(label: ProcessLabel, children: readonly ProcessNode[]): readonly ProcessNode[] {
	const matching = Array.filter(children, child => sameLabel(child.label, label))
	if (Array.isArrayEmpty(matching)) return children
	return [
		...Array.filter(children, child => !sameLabel(child.label, label)),
		...absorb(
			label,
			Array.flatMap(matching, child => child.children)
		)
	]
}

function fold(node: ProcessNode): ProcessNode {
	return {...node, children: absorb(node.label, Array.map(node.children, fold))}
}

// The app's processes as a tree: a child with its parent's label folds into it, and each process appears once.
export function processTree(rows: readonly Process[]) {
	const pids = MutableHashSet.fromIterable(Array.map(rows, row => row.pid))
	const children = Array.reduce(rows, HashMap.empty<ProcessId, readonly Process[]>(), (all, row) =>
		HashMap.set(all, row.parent, [...pipe(all, HashMap.get(row.parent), Option.getOrElse(Array.empty<Process>)), row])
	)
	const visited = MutableHashSet.empty<ProcessId>()
	function build(row: Process): ProcessNode {
		MutableHashSet.add(visited, row.pid)
		const below = pipe(
			children,
			HashMap.get(row.pid),
			Option.getOrElse(Array.empty<Process>),
			Array.filter(child => !MutableHashSet.has(visited, child.pid)),
			Array.map(build)
		)
		const self: ProcessNode = {
			children: [],
			command: row.command,
			cpu: row.cpu,
			label: row.label,
			memory: row.memory,
			pid: row.pid,
			small: false
		}
		return {...self, ...usage([self, ...below]), children: below}
	}
	const roots = pipe(
		Array.filter(rows, row => !MutableHashSet.has(pids, row.parent)),
		// A malformed source whose parents form a cycle has no root, so its first process starts the tree.
		Array.match({onEmpty: () => Array.take(rows, 1), onNonEmpty: Function.identity}),
		Array.map(node => fold(build(node)))
	)
	const appMemory = usage(roots).memory
	function place(node: ProcessNode): ProcessNode {
		return {...node, children: settle(Array.map(node.children, place), appMemory)}
	}
	return settle(Array.map(roots, place), appMemory)
}

function workerNames(snapshot: Snapshot) {
	return Array.dedupe([...snapshot.workers, ...Array.map(snapshot.items, item => item.worker)])
}

function sourceWorker(source: {readonly name: string}, workers: readonly WorkerId[], local: Option.Option<WorkerId>) {
	return pipe(
		workers,
		Array.findFirst(worker => sourceBelongsToWorker(source, worker)),
		Option.orElse(() => local)
	)
}

function errorsOf(
	sources: readonly {readonly error: Option.Option<string>; readonly name: string}[],
	workers: readonly WorkerId[],
	worker: WorkerId
) {
	const local = Array.head(workers)
	return pipe(
		sources,
		Array.filter(
			source => Option.isSome(source.error) && Option.contains(sourceWorker(source, workers, local), worker)
		),
		Array.map(source => `${String.replace(`${worker} · `, '')(source.name)}: ${Option.getOrThrow(source.error)}`)
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
	} satisfies App
}

function exposureOf(item: Extract<InventoryItem, {kind: 'exposure'}>) {
	return {
		access: pipe(
			item.publicAccess,
			Option.contains(true),
			Boolean.match({onFalse: () => 'tailnet' as const, onTrue: () => 'public' as const})
		),
		id: item.id,
		name: ExposureName.make(item.name),
		port: item.port,
		url: Option.getOrThrow(item.url)
	} satisfies HttpsExposure
}

function matches(row: Row, app: string) {
	const needle = String.toLowerCase(app)
	return Array.some([workloadName(row.item), row.item.name, ...Option.toArray(row.item.unit)], name =>
		String.includes(needle)(String.toLowerCase(name))
	)
}

function rank(row: Row) {
	if (row.item.health === 'error') return 0
	if (row.item.health === 'warning') return 1
	return 2
}

export const rowUsageOrder = Order.mapInput(Order.flip(Order.Number), (row: Row) =>
	pipe(
		Option.getOrElse(row.item.processes, Array.empty),
		Array.map(process => process.memory),
		Number.sumAll
	)
)

const appOrder = pipe(Order.Number, Order.mapInput(rank), Order.combine(rowUsageOrder))

const jobOrder = pipe(
	Order.Number,
	Order.mapInput(rank),
	Order.combine(Order.mapInput(Option.makeOrder(DateTime.Order), (row: Row) => row.item.next))
)

// The page's list per worker as compact JSON: its apps and scheduled jobs, the URLs it owns or can reach, and only the failures it would mark.
export function listApps(snapshot: Snapshot, input: InventoryQuery) {
	const app = Option.filter(input.app, String.isNonEmpty)
	const onlyFailing = Option.contains(input.failing, true)
	return pipe(
		workerNames(snapshot),
		Array.filter(worker => !Option.exists(input.worker, selected => selected !== worker)),
		Array.map(worker => {
			const own = Array.filter(workloads(snapshot.items), row => row.item.worker === worker)
			const apps = pipe(
				Array.filter(
					own,
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
					own,
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
			const exposures = pipe(
				own,
				Array.flatMap(row => {
					if (row.item.kind !== 'exposure' || onlyFailing) return []
					return [exposureOf(row.item)]
				}),
				Array.sort(Order.mapInput(Order.String, (exposure: HttpsExposure) => exposure.url))
			)
			return {
				apps,
				errors: Option.liftPredicate(
					errorsOf(snapshot.sources, workerNames(snapshot), worker),
					Array.isReadonlyArrayNonEmpty
				),
				exposures: Option.liftPredicate(exposures, Array.isReadonlyArrayNonEmpty),
				jobs: Option.liftPredicate(jobs, Array.isReadonlyArrayNonEmpty),
				worker
			}
		})
	)
}

// Each app's history name, keyed the way its samples are: `service:<scope>:<unit>` or `container:<short id>`, named as the page's rows name it.
export function ownerNames(snapshot: Snapshot) {
	const byWorker = Array.groupBy(snapshot.items, item => item.worker)
	return Record.fromEntries(
		Array.map(
			workerNames(snapshot),
			worker =>
				[
					worker,
					Record.fromEntries(
						pipe(
							byWorker[worker] ?? Array.empty<InventoryItem>(),
							Array.filter(item => item.kind === 'service' || item.kind === 'container'),
							Array.flatMap((item: InventoryItem) => [[itemOwner(item), workloadName(item)] as const])
						)
					)
				] as const
		)
	)
}

export function requestOf(item: InventoryItem) {
	return {
		name: UnitId.make(item.name),
		scope: Option.getOrElse(item.scope, () => 'system' as const),
		worker: item.worker
	} satisfies RunRequest
}

// The run request for a scheduled job the page shows, by its name or unit; both workers' jobs need a worker to choose.
export const jobRequest = Effect.fnUntraced(function* (snapshot: Snapshot, input: RunJobInput) {
	const matching = Array.filter(
		workloads(snapshot.items),
		row =>
			Option.contains(row.item.scheduled, true) &&
			!Option.exists(input.worker, worker => row.item.worker !== worker) &&
			(workloadName(row.item) === input.job || row.item.name === input.job)
	)
	if (Array.isArrayEmpty(matching)) {
		return yield* DeployError.make({message: `No scheduled job named ${input.job}; list_apps shows the jobs.`})
	}
	if (matching.length > 1) {
		return yield* DeployError.make({message: `${input.job} runs on more than one worker; pass its worker.`})
	}

	return requestOf(Option.getOrThrow(Array.head(matching)).item)
})
