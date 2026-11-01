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

export function important(item: InventoryItem) {
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
		Option.isNone(String.match(/^(?:dbus|dirmngr|gpg-|keyboxd|gcr-|gnome-|ssh-agent|openvpn3-)/u)(item.name))
	)
}

export function ports(items: readonly InventoryItem[]) {
	return pipe(
		items,
		Array.filter(item => loopbackPort(item) && !String.startsWith('stale')(item.state)),
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
