import {Array, Boolean, Function, Iterable, Number, Option, Schema, String} from 'effect'

import {ipv4Reachable, UnitId} from '#contracts'
import type {ServiceScope} from '#contracts'

import {ProcessIdFromString} from '#server/inventory/schema.ts'

export function socketLine(line: string) {
	const fields = String.split(String.trim(line), /\s+/u)
	const address = fields[4] ?? ''
	const state = fields[1] ?? ''
	if (!Array.contains(['tcp', 'udp'], fields[0]) || !String.isNonEmpty(state) || !String.isNonEmpty(address)) {
		return Option.none()
	}
	return Option.map(Number.parse(Array.lastNonEmpty(String.split(address, ':'))), port => ({
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
