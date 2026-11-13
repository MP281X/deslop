import {Array, Boolean, Iterable, Number, Option, Schema, String, pipe} from 'effect'

import {ProcessIdFromString, UnitId} from '#services/inventory/schema.ts'
import type {ProcessId} from '#services/inventory/schema.ts'

function portOf(address: string) {
	return Number.parse(Array.lastNonEmpty(String.split(address, ':')))
}

export function socketLine(line: string) {
	const fields = String.split(String.trim(line), /\s+/u)
	const address = fields[4] ?? ''
	return Option.map(portOf(address), port => ({
		address,
		port,
		process: Option.flatMap(String.match(/users:\(\("([^"]+)",pid=([0-9]+)/u)(line), match =>
			Option.map(Schema.decodeOption(ProcessIdFromString)(match[2] ?? ''), pid => ({name: match[1] ?? '', pid}))
		),
		protocol: fields[0],
		state: fields[1] ?? 'listening'
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
		Boolean.match(file.type === 'IPv4', {onFalse: () => '*:', onTrue: () => '0.0.0.0:'})
	)(file.address)
	return Option.flatMap(file.pid, pid =>
		Option.map(portOf(address), port => ({
			address,
			port,
			process: Option.some({name: file.process, pid}),
			protocol: String.toLowerCase(file.protocol),
			state: Boolean.match(file.protocol === 'TCP', {
				onFalse: () => 'UNCONN',
				onTrue: () => String.replace(/^ST=/u, '')(file.state) || 'LISTEN'
			})
		}))
	)
}

// A Mac's listening sockets from `lsof -nP +c0 -iTCP -sTCP:LISTEN -iUDP -F pctPnT`, read as `socketLine` reads ss: an IPv4 wildcard is 0.0.0.0, an IPv6 one `*`, and a socket that several descriptors share is listed once.
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

export function socketUnit(cgroup: string) {
	return Option.map(
		Iterable.findLast(String.matchAll(/\/([^/]+\.service)(?=\/|\n|$)/gu)(cgroup), () => true),
		match => UnitId.make(match[1] ?? '')
	)
}

export function socketProcess(name: string, cwd: string) {
	return Option.match(String.match(/\/apps\/([^/]+)(?:\/|$)/u)(cwd), {onNone: () => name, onSome: app => app[1] ?? ''})
}

export function probeSocket(listener: Option.Option.Value<ReturnType<typeof socketLine>>, process: string) {
	return (
		listener.protocol === 'tcp' &&
		listener.port >= 1024 &&
		Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(listener.address)) &&
		Option.isNone(String.match(/^(?:postgres|redis|ssh|cloudflared|tailscaled|caddy)$/u)(process))
	)
}
