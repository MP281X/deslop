import {Array, Boolean, Option, String} from 'effect'

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
