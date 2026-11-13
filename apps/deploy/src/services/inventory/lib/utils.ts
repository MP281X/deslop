import {
	Array,
	Boolean,
	DateTime,
	Effect,
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

import {DeployError} from '#services/inventory/schema.ts'
import type {
	InventoryItem,
	App,
	InventoryQuery,
	HttpsExposure,
	Job,
	Process,
	ProcessLabel,
	ProcessSummary,
	RunJobInput,
	RunRequest,
	Snapshot
} from '#services/inventory/schema.ts'

// A remote source prefixes its worker and a local one names its own collector, so a bare worker name is that worker's.
export function sourceBelongsToWorker(source: {readonly name: string}, worker: string) {
	return source.name === worker || String.startsWith(`${worker} · `)(source.name)
}

// The service or container a process or cgroup belongs to: `service:<scope>:<unit>` or `container:<short id>`. Under a user manager, `app-<name>.slice` holds what `<name>.service` started outside its own cgroup, like T3 Code's agents.
export function processOwner(cgroup: string) {
	const container = Option.getOrUndefined(
		String.match(/\/(?:docker-|docker\/)([a-f0-9]{12,64})(?:\.scope)?(?:\/|\n|$)/u)(cgroup)
	)?.[1]
	if (container !== undefined) return `container:${String.slice(0, 12)(container)}`
	const segments = String.split(cgroup, /[/\n]/u)
	const service = Option.getOrElse(Array.findLastIndex(segments, String.endsWith('.service')), () => -1)
	const manager = Option.getOrElse(
		Array.findFirstIndex(segments, segment => Option.isSome(String.match(/^user@[0-9]+\.service$/u)(segment))),
		() => Infinity
	)
	return Option.match(
		Option.flatMap(
			Option.liftPredicate(Array.drop(segments, manager + 1), () => service <= manager),
			below => Array.findFirst(below, segment => String.match(/^app-(.+)\.slice$/u)(segment))
		),
		{
			onNone: () =>
				`service:${Boolean.match(service > manager, {onFalse: () => 'system', onTrue: () => 'user'})}:${segments[service] ?? ''}`,
			onSome: match => `service:user:${match[1]}.service`
		}
	)
}

// A loopback proxy can only reach these TCP listeners, not a tailnet-interface-only socket or UDP.
function loopbackPort(item: InventoryItem) {
	return (
		item.kind === 'port' &&
		item.protocol === 'tcp' &&
		item.port !== undefined &&
		item.port >= 1024 &&
		Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(item.address ?? ''))
	)
}

function appPort(item: InventoryItem) {
	return (
		loopbackPort(item) &&
		item.process !== undefined &&
		item.process !== '' &&
		!Array.contains([5353, 5355], item.port ?? 0) &&
		Option.isNone(String.match(/^(?:ssh|cloudflared|tailscaled|caddy|ControlCenter)$/u)(item.process ?? ''))
	)
}

function important(item: InventoryItem) {
	if (String.includes('failed')(item.state) || String.includes('unhealthy')(item.detail)) return true
	if (item.kind === 'exposure') return item.owned === true || item.publicAccess === true
	if (item.kind === 'container') {
		return (
			Option.isSome(String.match(/^(?:stale · )?(?:running|restarting|paused)$/u)(item.state)) ||
			Option.isSome(String.match(/Exited \([1-9]/u)(item.detail))
		)
	}
	if (item.kind === 'port') return appPort(item)
	if (item.kind !== 'service') return false
	if (Option.isSome(String.match(/^(?:deslop-|preview-|t3code)/u)(item.name))) return true
	return (
		item.scope === 'user' &&
		Option.isSome(String.match(/(?:^| · )active · /u)(item.state)) &&
		Option.isNone(
			String.match(/^(?:dbus|dirmngr|gpg-|keyboxd|gcr-|gnome-|secret-service|ssh-agent|openvpn3-)/u)(item.name)
		)
	)
}

function ports(items: readonly InventoryItem[]) {
	return pipe(
		items,
		Array.filter(item => appPort(item) && item.http === true && !String.startsWith('stale')(item.state)),
		Array.sort(Order.mapInput(Order.String, (item: InventoryItem) => `${item.worker}:${item.port}:${item.address}`)),
		Array.dedupeWith((a, b) => a.worker === b.worker && a.port === b.port)
	)
}

export function itemOwner(item: InventoryItem) {
	if (item.kind === 'container') {
		return `container:${String.slice(0, 12)(Option.getOrElse(Array.last(String.split(item.id, ':docker:')), () => ''))}`
	}
	return `service:${item.scope ?? 'system'}:${item.name}`
}

function fullName(item: InventoryItem) {
	if (item.kind === 'port') return item.process ?? item.name
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

function sameSocket(listener: InventoryItem, binding: {address: string; port: number; protocol: 'tcp' | 'udp'}) {
	if (listener.address === 'container' || binding.address === 'container') return false
	if (listener.port !== binding.port || listener.protocol !== binding.protocol) return false
	if (listener.address === binding.address) return true
	return (
		Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(listener.address ?? '')) &&
		Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(binding.address))
	)
}

function socket(worker: string, binding: {address?: string; port?: number; protocol?: 'tcp' | 'udp'}) {
	const loopback = Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(binding.address ?? ''))
	return Tuple.make(
		worker,
		binding.protocol,
		binding.port,
		loopback,
		Boolean.match(loopback, {onFalse: () => binding.address, onTrue: () => ''})
	)
}

export function workloads(items: readonly InventoryItem[]) {
	const listeners = Array.filter(items, item => item.kind === 'port')
	const byUnit = Record.map(
		Array.groupBy(listeners, listener => listener.worker),
		worker => Array.groupBy(worker, listener => listener.unit ?? '')
	)
	const bySocket = HashMap.fromIterable(
		Array.map(
			Array.reverse(Array.filter(listeners, listener => listener.address !== 'container')),
			listener => [socket(listener.worker, listener), listener] as const
		)
	)
	const grouped = Array.map(
		Array.filter(items, item => item.kind === 'service' || item.kind === 'container'),
		item => {
			const attached = Array.filter(byUnit[item.worker]?.[item.name] ?? [], listener => listener.unit === item.name)
			const bindings = Array.map(item.bindings ?? [], binding => ({
				...item,
				...Option.getOrElse(
					Option.filter(HashMap.get(bySocket, socket(item.worker, binding)), () => binding.address !== 'container'),
					() => ({})
				),
				...binding,
				bindings: [],
				id: `${item.id}:port:${binding.address}`,
				kind: 'port' as const,
				process: item.name,
				unit: item.name,
				url: ''
			}))
			return {item, listeners: [...attached, ...bindings]}
		}
	)
	const services = HashSet.fromIterable(
		Array.map(
			Array.filter(grouped, row => row.item.kind === 'service'),
			row => Tuple.make(row.item.worker, row.item.name)
		)
	)
	const represented = HashSet.fromIterable(
		Array.flatMap(grouped, row =>
			Array.map(
				Array.filter(row.listeners, binding => binding.address !== 'container'),
				binding =>
					socket(row.item.worker, {
						address: binding.address ?? '',
						port: binding.port ?? 0,
						protocol: binding.protocol ?? 'tcp'
					})
			)
		)
	)
	const loose = Array.filter(
		listeners,
		listener =>
			!HashSet.has(services, Tuple.make(listener.worker, listener.unit)) &&
			(listener.address === 'container' || !HashSet.has(represented, socket(listener.worker, listener)))
	)
	const rows = [...grouped, ...Array.map(loose, item => ({item, listeners: [item]}))]
	const exposures = [
		...Array.filter(items, item => item.kind === 'exposure' && item.owned === true),
		...Array.filter(items, item => item.kind === 'exposure' && item.owned !== true)
	]
	const exposuresBySocket = Array.groupBy(
		Array.map(exposures, (item, index) => ({index, item})),
		entry => `${entry.item.worker}:${entry.item.port ?? 0}`
	)
	const linked = Array.map(rows, row => {
		const reachable = Array.dedupe(
			Array.map(
				Array.filter(row.listeners, listener =>
					sameSocket(listener, {address: `127.0.0.1:${listener.port}`, port: listener.port ?? 0, protocol: 'tcp'})
				),
				listener => listener.port ?? 0
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
					...Array.map(row.item.links ?? [], url => ({
						...row.item,
						id: `${row.item.id}:url:${url}`,
						kind: 'exposure' as const,
						owned: false,
						publicAccess: true,
						url
					})),
					...exposed
				],
				(a: InventoryItem, b: InventoryItem) => a.url === b.url
			)
		}
	})
	const linkedIds = HashSet.fromIterable(
		Array.flatMap(linked, row => Array.map(row.exposures, exposure => exposure.id))
	)
	const linkedUrls = HashSet.fromIterable(
		Array.flatMap(linked, row => Array.map(row.exposures, exposure => Tuple.make(exposure.worker, exposure.url)))
	)
	const remaining = Array.map(
		Array.filter(
			exposures,
			item => !HashSet.has(linkedIds, item.id) && !HashSet.has(linkedUrls, Tuple.make(item.worker, item.url))
		),
		item => ({exposures: [item], item, listeners: []})
	)
	return Array.map(
		Array.filter(
			[...linked, ...remaining],
			row =>
				important(row.item) &&
				(row.item.kind !== 'port' || (row.item.http === true && row.item.process !== '' && row.item.process !== 'node'))
		),
		row => {
			if (row.item.kind === 'container') return row
			const candidates = ports(row.listeners)
			const hasUi = Array.some(candidates, candidate => candidate.ui === true)
			const exposedPorts = HashSet.fromIterable(Array.map(row.exposures, exposure => exposure.port))
			return {
				...row,
				listeners: Array.filter(
					candidates,
					listener => !hasUi || listener.ui === true || HashSet.has(exposedPorts, listener.port)
				)
			}
		}
	)
}

export type Row = ReturnType<typeof workloads>[number]

export function availablePorts(rows: ReturnType<typeof workloads>) {
	return ports(
		Array.flatMap(rows, row =>
			Array.map(
				Array.filter(
					row.listeners,
					listener =>
						(!Array.some(row.listeners, candidate => candidate.ui === true) || listener.ui === true) &&
						Array.isReadonlyArrayEmpty(row.item.links ?? []) &&
						!Array.some(row.exposures, exposure => exposure.port === listener.port)
				),
				listener => ({...listener, process: workloadName(row.item)})
			)
		)
	)
}

const untilNext = new Intl.RelativeTimeFormat('en', {numeric: 'auto', style: 'narrow'})

export function status(item: InventoryItem) {
	if (String.startsWith('stale')(item.state)) return 'stale'
	if (String.includes('unhealthy')(item.detail)) return 'unhealthy'
	if (item.kind === 'port') return 'listening'
	if (item.kind === 'exposure' && item.owned === true) return 'configured'
	if (item.kind === 'exposure' && item.publicAccess === true) return 'public permission'
	return String.replace(/^active · /u, '')(String.toLowerCase(item.state))
}

// Only a problem is marked: a service that runs needs no dot to say so.
export function dot(item: InventoryItem, state: string) {
	if (Option.isSome(String.match(/failed|unhealthy|Exited \([1-9]/u)(item.state + item.detail))) return 'error'
	if (state === 'stale' || state === 'public permission' || state === 'restarting') return 'warning'
	return 'quiet'
}

// How long ago a service stopped: minutes within the hour, hours within two days, then days.
function since(at: number, now: number) {
	const minutes = Number.max(0, Number.round((now - at) / 60_000, 0))
	if (minutes < 60) return untilNext.format(-minutes, 'minute')
	if (minutes < 2880) return untilNext.format(-Number.round(minutes / 60, 0), 'hour')
	return untilNext.format(-Number.round(minutes / 1440, 0), 'day')
}

// When a timer next starts the job, against the snapshot's clock: minutes within the hour, then hours.
export function nextRun(next: number, now: number) {
	const minutes = Number.max(0, Number.round((next - now) / 60_000, 0))
	if (minutes < 60) return untilNext.format(minutes, 'minute')
	return untilNext.format(Number.round(minutes / 60, 0), 'hour')
}

// Why an app needs a look: the failure systemd recorded, else what its detail says.
export function reasonOf(item: InventoryItem) {
	return Option.match(Option.fromUndefinedOr(item.failure), {onNone: () => item.detail, onSome: stop => stop.reason})
}

export function failureAge(item: InventoryItem, now: number) {
	return Option.map(Option.fromUndefinedOr(item.failure?.at), at => since(at, now))
}

export function reasonLine(item: InventoryItem, now: number) {
	return Option.match(failureAge(item, now), {
		onNone: () => reasonOf(item),
		onSome: age => `${reasonOf(item)} · ${age}`
	})
}

// A process with everything below it: `memory` and `cpu` cover the subtree; `cpu` stays unknown while no member reports one.
export type ProcessNode = {
	children: readonly ProcessNode[]
	command?: readonly string[]
	cpu?: number
	label: ProcessLabel
	memory: number
	pid: number
	small: boolean
}

function usage(nodes: readonly ProcessNode[]) {
	const cpus = Array.getSomes(Array.map(nodes, node => Option.fromUndefinedOr(node.cpu)))
	return {
		...Boolean.match(Array.isReadonlyArrayNonEmpty(cpus), {
			onFalse: () => ({}),
			onTrue: () => ({cpu: Number.sumAll(cpus)})
		}),
		memory: Number.sumAll(Array.map(nodes, node => node.memory))
	}
}

const byUsage = Order.combine(
	Order.mapInput(Order.flip(Order.Number), (node: ProcessNode) => node.memory),
	Order.mapInput(Order.flip(Order.Number), (node: ProcessNode) => node.cpu ?? 0)
)

// Children heaviest first; below 2% of the app's memory and half a percent of the machine's CPU a process barely moves the usage, so it reads muted.
function settle(children: readonly ProcessNode[], appMemory: number) {
	return Array.map(Array.sort(children, byUsage), node => ({
		...node,
		small: node.memory < appMemory * 0.02 && (node.cpu ?? 0) < 0.5
	}))
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
	const children = Array.groupBy(rows, row => `${row.parent}`)
	const visited = MutableHashSet.empty<number>()
	function build(row: Process): ProcessNode {
		MutableHashSet.add(visited, row.pid)
		const below = Array.map(
			Array.filter(children[`${row.pid}`] ?? [], child => !MutableHashSet.has(visited, child.pid)),
			build
		)
		const self: ProcessNode = {
			children: [],
			...Option.match(Option.fromUndefinedOr(row.command), {onNone: () => ({}), onSome: command => ({command})}),
			...Option.match(Option.fromUndefinedOr(row.cpu), {onNone: () => ({}), onSome: cpu => ({cpu})}),
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

export function appUsage(rows: readonly Process[]) {
	return {
		cpu: Array.match(Array.getSomes(Array.map(rows, row => Option.fromUndefinedOr(row.cpu))), {
			onEmpty: () => undefined,
			onNonEmpty: values => Number.round(Number.sumAll(values), 2)
		}),
		memory: Number.sumAll(Array.map(rows, row => row.memory))
	}
}

function workerNames(snapshot: Snapshot) {
	return Array.dedupe([...(snapshot.workers ?? []), ...Array.map(snapshot.items, item => item.worker)])
}

function sourceWorker(source: {readonly name: string}, workers: readonly string[], local: string) {
	return Option.getOrElse(
		Array.findFirst(workers, worker => sourceBelongsToWorker(source, worker)),
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
	const reachable = portsOf(row)
	const url = Option.map(Array.head(row.exposures), exposure => exposure.url)
	return {
		...failureOf(row.item),
		id: row.item.id,
		name: workloadName(row.item),
		...Boolean.match(Array.isReadonlyArrayNonEmpty(reachable), {
			onFalse: () => ({}),
			onTrue: () => ({ports: reachable})
		}),
		...Boolean.match(withProcesses && Array.isReadonlyArrayNonEmpty(row.item.processes ?? []), {
			onFalse: () => ({}),
			onTrue: () => ({processes: Array.map(processTree(row.item.processes ?? []), summaryOf)})
		}),
		state: row.item.state,
		...Record.getSomes({url})
	} satisfies App
}

function jobOf(row: Row) {
	return {
		...failureOf(row.item),
		id: row.item.id,
		name: workloadName(row.item),
		...Record.getSomes({next: Option.map(Option.fromUndefinedOr(row.item.next), iso)})
	} satisfies Job
}

function exposureOf(item: InventoryItem) {
	return {
		access: Boolean.match(item.publicAccess === true, {
			onFalse: () => 'tailnet' as const,
			onTrue: () => 'public' as const
		}),
		id: item.id,
		name: item.name,
		...Record.getSomes({port: Option.fromUndefinedOr(item.port)}),
		url: item.url
	} satisfies HttpsExposure
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
export function listApps(snapshot: Snapshot, input: InventoryQuery) {
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
				Array.sort(Order.mapInput(Order.String, (exposure: HttpsExposure) => exposure.url))
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
	const byWorker = Array.groupBy(snapshot.items, item => item.worker)
	return Record.fromEntries(
		Array.map(
			workerNames(snapshot),
			worker =>
				[
					worker,
					Record.fromEntries(
						Array.flatMap(
							Array.filter(byWorker[worker] ?? [], item => item.kind === 'service' || item.kind === 'container'),
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
