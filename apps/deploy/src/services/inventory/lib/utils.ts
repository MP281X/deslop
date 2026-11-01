import {Array, Boolean, Option, Order, String, pipe} from 'effect'

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

export function ports(items: readonly InventoryItem[]) {
	return pipe(
		items,
		Array.filter(item => appPort(item) && item.http === true && !String.startsWith('stale')(item.state)),
		Array.sort(
			Order.mapInput(
				Order.String,
				(item: InventoryItem) =>
					`${Boolean.match(appPort(item), {onFalse: () => '1', onTrue: () => '0'})}:${item.worker}:${item.port}:${item.address}`
			)
		),
		Array.dedupeWith((a, b) => a.worker === b.worker && a.port === b.port)
	)
}

export function portLabel(item: InventoryItem) {
	return `${item.process || 'TCP'} · :${item.port} · ${item.worker}`
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

export function workloads(items: readonly InventoryItem[], all: boolean) {
	const listeners = Array.filter(items, item => item.kind === 'port')
	const grouped = Array.map(
		Array.filter(items, item => item.kind === 'service' || item.kind === 'container'),
		item => {
			const attached = Array.filter(
				listeners,
				listener => listener.worker === item.worker && listener.unit === item.name
			)
			const bindings = Array.map(item.bindings ?? [], binding => ({
				...item,
				...Option.getOrElse(
					Array.findFirst(listeners, listener => listener.worker === item.worker && sameSocket(listener, binding)),
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
	const loose = Array.filter(
		listeners,
		listener =>
			!Array.some(
				grouped,
				row =>
					row.item.worker === listener.worker &&
					((row.item.kind === 'service' && row.item.name === listener.unit) ||
						Array.some(row.listeners, binding =>
							sameSocket(listener, {
								address: binding.address ?? '',
								port: binding.port ?? 0,
								protocol: binding.protocol ?? 'tcp'
							})
						))
			)
	)
	const rows = [...grouped, ...Array.map(loose, item => ({item, listeners: [item]}))]
	const exposures = [
		...Array.filter(items, item => item.kind === 'exposure' && item.owned === true),
		...Array.filter(items, item => item.kind === 'exposure' && item.owned !== true)
	]
	const linked = Array.map(rows, row => ({
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
				...Array.filter(
					exposures,
					item =>
						item.worker === row.item.worker &&
						Array.some(row.listeners, listener =>
							sameSocket(listener, {address: `127.0.0.1:${item.port}`, port: item.port ?? 0, protocol: 'tcp'})
						)
				)
			],
			(a: InventoryItem, b: InventoryItem) => a.url === b.url
		)
	}))
	const remaining = Array.map(
		Array.filter(
			exposures,
			item =>
				!Array.some(linked, row =>
					Array.some(
						row.exposures,
						exposure => exposure.id === item.id || (exposure.url === item.url && exposure.worker === item.worker)
					)
				)
		),
		item => ({exposures: [item], item, listeners: []})
	)
	return Array.map(
		Array.filter(
			[...linked, ...remaining],
			row =>
				all ||
				(important(row.item) &&
					(row.item.kind !== 'port' ||
						(row.item.http === true && row.item.process !== '' && row.item.process !== 'node')))
		),
		row => {
			if (all || row.item.kind === 'container') return row
			const candidates = ports(row.listeners)
			return {
				...row,
				listeners: Array.filter(
					candidates,
					listener =>
						!Array.some(candidates, candidate => candidate.ui === true) ||
						listener.ui === true ||
						Array.some(row.exposures, exposure => exposure.port === listener.port)
				)
			}
		}
	)
}
