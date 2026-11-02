import {Array, Effect, FileSystem, Option, Schema, String, pipe} from 'effect'

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
	return Array.map(items, item => ({
		...item,
		processes: Array.map(
			Array.filter(records, record => {
				if (item.kind === 'container') {
					return String.includes(String.split(item.id, ':docker:')[1] ?? item.id)(record.cgroup)
				}
				if (item.kind !== 'service') return false
				return (
					Array.contains(String.split(record.cgroup, /[/\n]/u), item.name) &&
					String.includes('/user.slice/')(record.cgroup) === (item.scope === 'user')
				)
			}),
			record => record.process
		)
	}))
}
