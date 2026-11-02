import {Array, Boolean, Effect, FileSystem, Match, Option, Schema, String, pipe} from 'effect'

import type {InventoryItem} from '#services/inventory/schema.ts'

function processStatus(status: string) {
	function field(name: string) {
		return String.trim(
			Option.getOrElse(String.match(new RegExp(`^${name}:\\s*([^\\n]+)`, 'mu'))(status), () => ['', ''])[1] ?? ''
		)
	}
	return {
		memory: Schema.decodeSync(Schema.FiniteFromString)((String.split(field('VmRSS'), /\s+/u)[0] ?? '') || '0') * 1024,
		name: field('Name'),
		parent: Schema.decodeSync(Schema.FiniteFromString.check(Schema.isInt()))(field('PPid')),
		pid: Schema.decodeSync(Schema.FiniteFromString.check(Schema.isInt()))(field('Pid'))
	}
}

export const processes = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	return yield* pipe(
		Effect.forEach(
			Array.filter(yield* fs.readDirectory('/proc'), name => Option.isSome(String.match(/^[0-9]+$/u)(name))),
			pid =>
				pipe(
					Effect.gen(function* () {
						const status = yield* fs.readFileString(`/proc/${pid}/status`)
						return {
							cgroup: yield* fs.readFileString(`/proc/${pid}/cgroup`),
							process: yield* Effect.try(() => processStatus(status))
						}
					}),
					Effect.option
				),
			{concurrency: 16}
		),
		Effect.map(Array.getSomes)
	)
})

export function attachProcesses(items: readonly InventoryItem[], records: Effect.Success<typeof processes>) {
	const owners = Array.groupBy(records, record => {
		const container = Option.getOrUndefined(
			String.match(/\/(?:docker-|docker\/)([a-f0-9]{12,64})(?:\.scope)?(?:\/|\n|$)/u)(record.cgroup)
		)?.[1]
		if (container !== undefined) return `container:${String.slice(0, 12)(container)}`
		const segments = String.split(record.cgroup, /[/\n]/u)
		const service = Option.getOrElse(Array.findLastIndex(segments, String.endsWith('.service')), () => -1)
		const manager = Option.getOrElse(
			Array.findFirstIndex(segments, segment => Option.isSome(String.match(/^user@[0-9]+\.service$/u)(segment))),
			() => Infinity
		)
		return `service:${Boolean.match(service > manager, {onFalse: () => 'system', onTrue: () => 'user'})}:${segments[service] ?? ''}`
	})
	return Array.map(items, item => ({
		...item,
		processes: Array.map(
			pipe(
				Match.value(item.kind),
				Match.when('service', () => owners[`service:${item.scope}:${item.name}`] ?? []),
				Match.when(
					'container',
					() => owners[`container:${String.slice(0, 12)(String.split(item.id, ':docker:')[1] ?? '')}`] ?? []
				),
				Match.orElse(() => [])
			),
			record => record.process
		)
	}))
}
