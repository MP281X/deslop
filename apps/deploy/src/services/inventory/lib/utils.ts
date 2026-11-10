import {
	Array,
	Boolean,
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

import type {InventoryItem, Process, ProcessLabel} from '#services/inventory/schema.ts'

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
		Option.isNone(String.match(/^(?:ssh|cloudflared|tailscaled|caddy)$/u)(item.process ?? ''))
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
