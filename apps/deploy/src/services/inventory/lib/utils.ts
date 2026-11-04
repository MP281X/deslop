import {Array, Boolean, Match, Number, Option, Order, Record, String, pipe} from 'effect'

import type {InventoryItem} from '#services/inventory/schema.ts'

const SIGNALS: Record<number, string> = {
	1: 'SIGHUP',
	2: 'SIGINT',
	6: 'SIGABRT',
	9: 'SIGKILL',
	11: 'SIGSEGV',
	15: 'SIGTERM'
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

function failureReason(result: string, status: number, ran: boolean) {
	if (result === 'exit-code' && !ran) return 'Failed before starting'
	const signal = SIGNALS[status] ?? `signal ${status}`
	return pipe(
		Match.value(result),
		Match.when('exit-code', () =>
			Option.match(Option.fromUndefinedOr(SIGNALS[status - 128]), {
				onNone: () => `Exited with code ${status}`,
				onSome: name => `Exited with code ${status} (${name})`
			})
		),
		Match.when('signal', () => `Killed by ${signal}`),
		Match.when('core-dump', () => `Crashed with ${signal}`),
		Match.when('oom-kill', () => 'Killed for running out of memory'),
		Match.when('timeout', () => 'Timed out'),
		Match.when('watchdog', () => 'Stopped answering its watchdog'),
		Match.when('start-limit-hit', () => 'Restarted too often'),
		Match.orElse(() => `Failed: ${result}`)
	)
}

// Why each failed unit stopped and when, by unit, from `systemctl show -p Id,Result,ExecMainCode,ExecMainStatus,StateChangeTimestamp --timestamp=unix`.
export function unitFailures(text: string) {
	return Record.fromEntries(
		Array.map(Array.filter(String.split(String.trim(text), /\n\s*\n/u), String.isNonEmpty), block => {
			const fields = Record.fromEntries(
				Array.map(Array.filter(String.split(block, '\n'), String.includes('=')), line => {
					const [key, ...value] = String.split(line, '=')
					return [key, Array.join(value, '=')] as const
				})
			)
			return [
				fields['Id'] ?? '',
				{
					...Option.match(Number.parse(String.replace(/^@/u, '')(fields['StateChangeTimestamp'] ?? '')), {
						onNone: () => ({}),
						onSome: seconds => ({at: seconds * 1000})
					}),
					// A unit whose start step failed never ran its main process, which leaves its code 0.
					reason: failureReason(
						fields['Result'] ?? '',
						Option.getOrElse(Number.parse(fields['ExecMainStatus'] ?? ''), () => 0),
						fields['ExecMainCode'] !== '0'
					)
				}
			] as const
		})
	)
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

// The owner key a service or container's processes carry, so history recorded by owner finds its row.
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

export function workloads(items: readonly InventoryItem[]) {
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
				important(row.item) &&
				(row.item.kind !== 'port' || (row.item.http === true && row.item.process !== '' && row.item.process !== 'node'))
		),
		row => {
			if (row.item.kind === 'container') return row
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

export function availablePorts(items: readonly InventoryItem[]) {
	return ports(
		Array.flatMap(workloads(items), row =>
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
