import {Array, Boolean, HashMap, HashSet, Option, Order, Record, String, Tuple, pipe} from 'effect'

import type {InventoryItem} from '#services/inventory/schema.ts'

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
