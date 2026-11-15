import {Array, Number, Option, Schema, String, pipe} from 'effect'

import {ProcessIdFromString, UnitId} from '#services/inventory/schema.ts'

// `application.*` jobs belong to Launch Services, not user launch agents; lsappinfo decides which are regular Dock apps.
export function launchAgents(text: string) {
	return Array.getSomes(
		pipe(
			text,
			String.split('\n'),
			Array.map(line => {
				const [pid, status = '', label = ''] = String.split(String.trim(line), '\t')
				if (
					!String.isNonEmpty(label) ||
					String.startsWith('com.apple.')(label) ||
					String.startsWith('application.')(label) ||
					(String.startsWith('deslop-')(label) && String.endsWith('-update')(label))
				) {
					return Option.none()
				}
				const processId = Option.filter(Schema.decodeOption(ProcessIdFromString)(pid), value => value > 0)
				if (Option.isNone(processId) && pid !== '-') return Option.none()
				return Option.some({
					detail: 'user · launch agent',
					label: UnitId.make(label),
					pid: processId,
					status: Number.parse(status)
				})
			})
		)
	)
}

// `lsappinfo list` needs no Automation permission. Foreground is the regular application type, not whether its window is in front.
export function dockApplications(text: string) {
	return Array.getSomes(
		pipe(
			text,
			String.split(/\n(?=\s*[0-9]+\))/u),
			Array.map(block => {
				const name = pipe(
					String.match(/^\s*[0-9]+\) "(.+)" ASN:/u)(block),
					Option.map(match => match[1] ?? ''),
					Option.filter(String.isNonEmpty)
				)
				const pid = pipe(
					String.match(/^\s+pid = ([0-9]+) .*\btype="Foreground"(?:\s|$)/mu)(block),
					Option.flatMap(match => Schema.decodeOption(ProcessIdFromString)(match[1] ?? '')),
					Option.filter(value => value > 0)
				)
				return Option.map(Option.all({name, pid}), app => ({
					detail: 'user · application',
					label: UnitId.make(app.name),
					pid: app.pid
				}))
			})
		)
	)
}

// Prefer the Dock name when Launch Services and launchd report the same process.
export function macApplications(
	agents: ReturnType<typeof launchAgents>,
	applications: ReturnType<typeof dockApplications>
) {
	const running = Array.getSomes(
		Array.map(agents, agent => Option.map(agent.pid, pid => ({detail: agent.detail, label: agent.label, pid})))
	)
	return Array.dedupeWith([...applications, ...running], (left, right) => left.pid === right.pid)
}
