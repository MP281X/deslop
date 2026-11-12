import {Array, Number, Option, String} from 'effect'

// Deslop's apps from `launchctl list`: each runs as the launch agent `deslop-<app>`, whose `deslop-<app>-update` agent only updates it. `status` is the last exit status.
export function launchAgents(text: string) {
	return Array.getSomes(
		Array.map(Array.drop(String.split(String.trim(text), '\n'), 1), line => {
			const [pid, status, label] = String.split(line, '\t')
			return Option.map(
				Option.liftPredicate(
					label ?? '',
					name => String.startsWith('deslop-')(name) && !String.endsWith('-update')(name)
				),
				name => ({label: name, pid: Number.parse(pid), status: Option.getOrElse(Number.parse(status ?? ''), () => 0)})
			)
		})
	)
}
