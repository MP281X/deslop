import {Array, Boolean, Clock, Effect, FileSystem, Match, Number, Option, Record, Schema, String, pipe} from 'effect'

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
	const counts = yield* Schema.decodeEffect(Schema.Array(Schema.FiniteFromString))(
		Array.take(
			Array.drop(
				String.split(String.trim(String.split(yield* fs.readFileString('/proc/stat'), '\n')[0] ?? ''), /\s+/u),
				1
			),
			8
		)
	)
	const total = Array.reduce(counts, 0, (sum, value) => sum + value)
	const records = yield* pipe(
		Effect.forEach(
			Array.filter(yield* fs.readDirectory('/proc'), name => Option.isSome(String.match(/^[0-9]+$/u)(name))),
			pid =>
				pipe(
					Effect.gen(function* () {
						const status = yield* fs.readFileString(`/proc/${pid}/status`)
						const stat = yield* fs.readFileString(`/proc/${pid}/stat`)
						const fields = String.split(
							String.slice(Option.getOrElse(String.lastIndexOf(')')(stat), () => -1) + 2)(stat),
							/\s+/u
						)
						return {
							cgroup: yield* fs.readFileString(`/proc/${pid}/cgroup`),
							process: yield* Effect.try(() => processStatus(status)),
							start: yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[19] ?? ''),
							ticks:
								(yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[11] ?? '')) +
								(yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[12] ?? ''))
						}
					}),
					Effect.option
				),
			{concurrency: 16}
		),
		Effect.map(Array.getSomes)
	)
	return {records, time: yield* Clock.currentTimeMillis, total}
})

export function processUsage(current: Effect.Success<typeof processes>, previous?: Effect.Success<typeof processes>) {
	const known = Record.fromEntries(Array.map(previous?.records ?? [], record => [`${record.process.pid}`, record]))
	return Array.map(current.records, record => {
		const old = known[record.process.pid]
		const elapsed = current.total - (previous?.total ?? current.total)
		return {
			...record,
			process: {
				...record.process,
				cpu: Option.getOrUndefined(
					Option.map(
						Option.filter(
							Option.fromUndefinedOr(old),
							value =>
								value.start === record.start &&
								elapsed > 0 &&
								record.ticks >= value.ticks &&
								current.time - (previous?.time ?? current.time) >= 2000 &&
								current.time - (previous?.time ?? 0) <= 30_000
						),
						value => Number.clamp(((record.ticks - value.ticks) / elapsed) * 100, {maximum: 100, minimum: 0})
					)
				)
			}
		}
	})
}

export function attachProcesses(
	items: readonly InventoryItem[],
	records: readonly {cgroup: string; process: NonNullable<InventoryItem['processes']>[number]}[]
) {
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
