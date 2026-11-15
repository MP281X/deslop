import {Array, Number, Option, Schema, String, pipe} from 'effect'

import {ProcessIdFromString, UnitId} from '#services/inventory/schema.ts'

// Use the enclosing app, not a nested helper app, as the identity shared with the Dock.
export function applicationBundle(path: string) {
	return pipe(
		String.match(/^(\/[^\n]*?\.app)(?:\/|$)/u)(path),
		Option.map(match => match[1] ?? ''),
		Option.filter(String.isNonEmpty)
	)
}

// Only top-level fields: never mistake a nested environment value for the executable.
export function launchProgram(text: string) {
	return pipe(
		String.match(/^\tprogram = (\/[^\n]+)$/mu)(text),
		Option.map(match => match[1] ?? ''),
		Option.filter(String.isNonEmpty)
	)
}

export function systemProgram(path: string) {
	return /^(?:\/System|\/usr|\/bin|\/sbin|\/Library\/Apple)(?:\/|$)/u.test(path)
}

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
					bundle: Option.none<string>(),
					detail: 'user · launch agent',
					label: UnitId.make(label),
					name: label,
					pid: processId,
					status: Number.parse(status)
				})
			})
		)
	)
}

// `lsappinfo list` needs no Automation permission. Foreground is the regular application type, not whether its window is in front.
export function dockApplications(text: string, agentBundles: readonly string[] = []) {
	return Array.getSomes(
		pipe(
			text,
			String.split(/\n(?=\s*[0-9]+\))/u),
			Array.map(block => {
				const bundle = pipe(
					String.match(/^\s+bundle path="([^"\n]+)"\s*$/mu)(block),
					Option.flatMap(match => applicationBundle(match[1] ?? ''))
				)
				// A tray-only app can still own a launch agent and listeners (Bitwarden's UIElement).
				const agentApplication = Option.exists(bundle, value => Array.contains(agentBundles, value))
				const name = pipe(
					String.match(/^\s*[0-9]+\) "(.+)" ASN:/u)(block),
					Option.map(match => match[1] ?? ''),
					Option.filter(String.isNonEmpty)
				)
				const pid = pipe(
					String.match(/^\s+pid = ([0-9]+) .*\btype="(Foreground|UIElement)"(?:\s|$)/mu)(block),
					Option.filter(match => match[2] === 'Foreground' || agentApplication),
					Option.flatMap(match => Schema.decodeOption(ProcessIdFromString)(match[1] ?? '')),
					Option.filter(value => value > 0)
				)
				return Option.map(Option.all({name, pid}), app => ({
					bundle,
					detail: 'user · application',
					label: UnitId.make(app.name),
					name: app.name,
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
	const running = Array.getSomes(Array.map(agents, agent => Option.map(agent.pid, pid => ({...agent, pid}))))
	const roots = [...applications, ...running]
	return Array.dedupeWith(
		Array.map(roots, app => {
			const dock = Array.findFirst(
				applications,
				candidate => candidate.pid === app.pid ||
					Option.exists(app.bundle, bundle => Option.contains(candidate.bundle, bundle))
			)
			const bundledAgent = Array.findFirst(running, candidate =>
				Option.exists(app.bundle, bundle => Option.contains(candidate.bundle, bundle))
			)
			const name = Option.match(bundledAgent, {
				onNone: () => Option.match(dock, {onNone: () => app.name, onSome: candidate => candidate.name}),
				onSome: agent => agent.name
			})
			return {
				...app,
				label: UnitId.make(
					Option.getOrElse(app.bundle, () =>
						Option.getOrElse(Option.map(dock, candidate => candidate.label), () => app.label)
					)
				),
				name,
				detail: Option.match(dock, {onNone: () => app.detail, onSome: candidate => candidate.detail})
			}
		}),
		(left, right) => left.pid === right.pid
	)
}
