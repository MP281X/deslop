import {Array, Boolean, Function, Iterable, Number, Option, Schema, String, pipe} from 'effect'

import {ipv4Reachable} from '#services/inventory/lib/utils.ts'
import {ProcessIdFromString, UnitId} from '#services/inventory/schema.ts'
import type {ProcessId, ServiceScope} from '#services/inventory/schema.ts'

function portOf(address: string) {
	return Number.parse(Array.lastNonEmpty(String.split(address, ':')))
}

export function socketLine(line: string) {
	const fields = String.split(String.trim(line), /\s+/u)
	const address = fields[4] ?? ''
	const state = fields[1] ?? ''
	if (!Array.contains(['tcp', 'udp'], fields[0]) || !String.isNonEmpty(state) || !String.isNonEmpty(address)) {
		return Option.none()
	}
	return Option.map(portOf(address), port => ({
		address,
		port,
		// A name may itself hold a quote; it ends at the quote before its pid.
		process: Option.flatMap(String.match(/users:\(\("(.+?)",pid=([0-9]+)/u)(line), match =>
			Option.map(Schema.decodeOption(ProcessIdFromString)(match[2] ?? ''), pid => ({name: match[1] ?? '', pid}))
		),
		protocol: fields[0],
		state
	}))
}

export type Socket = Option.Option.Value<ReturnType<typeof socketLine>>

type OpenFile = {
	address: string
	pid: Option.Option<ProcessId>
	process: string
	protocol: string
	state: string
	type: string
}

function lsofSocket(file: OpenFile) {
	if (String.includes('->')(file.address) || !Array.contains(['TCP', 'UDP'], file.protocol)) {
		return Option.none<Socket>()
	}
	const address = String.replace(
		/^\*:/u,
		Boolean.match(file.type === 'IPv4', {onFalse: Function.constant('*:'), onTrue: Function.constant('0.0.0.0:')})
	)(file.address)
	return Option.flatMap(file.pid, pid =>
		Option.map(portOf(address), port => ({
			address,
			port,
			process: Option.some({name: file.process, pid}),
			protocol: String.toLowerCase(file.protocol),
			state: Boolean.match(file.protocol === 'TCP', {
				onFalse: Function.constant('UNCONN'),
				onTrue: () => String.replace(/^ST=/u, '')(file.state) || 'LISTEN'
			})
		}))
	)
}

// A Mac's listening sockets from `lsof -nP +c0 -iTCP -sTCP:LISTEN -iUDP -F pcftPnT`, read as `socketLine` reads ss: each `f` line starts a descriptor, an IPv4 wildcard is 0.0.0.0, an IPv6 one `*`, and a socket that several descriptors share is listed once.
export function lsofSockets(text: string) {
	const empty: OpenFile = {address: '', pid: Option.none(), process: '', protocol: '', state: '', type: ''}
	const scanned = pipe(
		text,
		String.split('\n'),
		Array.reduce({file: empty, sockets: Array.empty<Socket>()}, (scan, line) => {
			const value = String.slice(1)(line)
			const flushed = [...scan.sockets, ...Option.toArray(lsofSocket(scan.file))]
			if (String.startsWith('p')(line)) {
				return {file: {...empty, pid: Schema.decodeOption(ProcessIdFromString)(value)}, sockets: flushed}
			}
			if (String.startsWith('c')(line)) return {...scan, file: {...scan.file, process: value}}
			if (String.startsWith('f')(line)) {
				return {file: {...empty, pid: scan.file.pid, process: scan.file.process}, sockets: flushed}
			}
			if (String.startsWith('t')(line)) return {...scan, file: {...scan.file, type: value}}
			if (String.startsWith('P')(line)) return {...scan, file: {...scan.file, protocol: value}}
			if (String.startsWith('n')(line)) return {...scan, file: {...scan.file, address: value}}
			if (String.startsWith('TST=')(line)) return {...scan, file: {...scan.file, state: value}}
			return scan
		})
	)
	return Array.dedupeWith(
		[...scanned.sockets, ...Option.toArray(lsofSocket(scanned.file))],
		(a, b) => a.protocol === b.protocol && a.address === b.address
	)
}

// The service a cgroup path names, and whether a user manager runs it, so a user and a system unit of one name stay apart.
export function socketUnit(cgroup: string) {
	return Option.map(
		Iterable.findLast(String.matchAll(/\/([^/]+\.service)(?=\/|\n|$)/gu)(cgroup), Function.constTrue),
		match => ({
			scope: Boolean.match(Option.isSome(String.match(/\/user@[0-9]+\.service\/.*\.service(?:\/|\n|$)/u)(cgroup)), {
				onFalse: Function.constant<ServiceScope>('system'),
				onTrue: Function.constant<ServiceScope>('user')
			}),
			unit: UnitId.make(match[1] ?? '')
		})
	)
}

export function socketProcess(name: string, cwd: string) {
	return Option.match(String.match(/\/apps\/([^/]+)(?:\/|$)/u)(cwd), {onNone: () => name, onSome: app => app[1] ?? ''})
}

export function probeSocket(listener: Option.Option.Value<ReturnType<typeof socketLine>>, process: string) {
	return (
		listener.protocol === 'tcp' &&
		listener.port >= 1024 &&
		ipv4Reachable(listener.address) &&
		Option.isNone(String.match(/^(?:postgres|redis|ssh|cloudflared|tailscaled|caddy)$/u)(process))
	)
}
