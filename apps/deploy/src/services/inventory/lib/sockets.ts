import {Array, Iterable, Number, Option, String} from 'effect'

export function socketLine(line: string) {
	const fields = String.split(String.trim(line), /\s+/u)
	const address = fields[4] ?? ''
	return Option.map(Number.parse(Option.getOrElse(Array.last(String.split(address, ':')), () => '')), port => ({
		address,
		port,
		process: Option.map(String.match(/users:\(\("([^"]+)",pid=([0-9]+)/u)(line), match => ({
			name: match[1] ?? '',
			pid: match[2]
		})),
		protocol: fields[0],
		state: fields[1] ?? 'listening'
	}))
}

export function socketUnit(cgroup: string) {
	return Option.getOrElse(
		Option.map(
			Iterable.findLast(String.matchAll(/\/([^/]+\.service)(?=\/|\n|$)/gu)(cgroup), () => true),
			match => match[1] ?? ''
		),
		() => ''
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
