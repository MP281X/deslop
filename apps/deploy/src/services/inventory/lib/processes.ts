import {Array, Boolean, Clock, Effect, FileSystem, Number, Option, Record, Schema, String, pipe} from 'effect'

import {itemOwner, processOwner} from '#services/inventory/lib/utils.ts'
import type {InventoryItem, Process} from '#services/inventory/schema.ts'

const PROCESS_INTERVAL = 2000
const SECRET = /(?:token|secret|passw(?:or)?d|key|auth|credential|cookie|session)/iu

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

// What a process was started with, as its arguments: flags and variables named like secrets, the value after such a flag, long opaque strings and URL credentials are masked, and each argument and their number are capped.
function commandArgs(cmdline: string) {
	const args = Array.take(Array.filter(String.split(cmdline, '\0'), String.isNonEmpty), 40)
	return Array.map(args, (arg, index) => {
		if (Option.isSome(String.match(/^-{0,2}[\w.-]+=/u)(arg)) && SECRET.test(String.split(arg, '=')[0] ?? '')) {
			return `${String.split(arg, '=')[0]}=…`
		}
		if (index > 0 && SECRET.test(args[index - 1] ?? '') && String.startsWith('-')(args[index - 1] ?? '')) return '…'
		if (!String.startsWith('/')(arg) && Option.isSome(String.match(/^[\w+/=-]{32,}$/u)(arg))) return '…'
		return String.slice(0, 200)(String.replaceAll(/:\/\/[^/@\s]+@/gu, '://…@')(arg))
	})
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
							process: {
								...(yield* Effect.try(() => processStatus(status))),
								// A process whose arguments can't be read still counts, without its preview.
								...Option.match(yield* Effect.option(fs.readFileString(`/proc/${pid}/cmdline`)), {
									onNone: () => ({}),
									onSome: cmdline => ({command: commandArgs(cmdline)})
								})
							},
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

function processUsage(current: Effect.Success<typeof processes>, previous?: Effect.Success<typeof processes>) {
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
								current.time - (previous?.time ?? current.time) >= PROCESS_INTERVAL &&
								current.time - (previous?.time ?? 0) <= 90_000
						),
						value => Number.clamp(((record.ticks - value.ticks) / elapsed) * 100, {maximum: 100, minimum: 0})
					)
				)
			}
		}
	})
}

export function processReadings(
	current: Effect.Success<typeof processes>,
	previous?: {baseline: Effect.Success<typeof processes>; readings: readonly {start: number; process: Process}[]}
) {
	if (
		previous !== undefined &&
		current.time >= previous.baseline.time &&
		current.time - previous.baseline.time < PROCESS_INTERVAL
	) {
		const known = Record.fromEntries(Array.map(previous.readings, record => [`${record.process.pid}`, record]))
		return {
			baseline: previous.baseline,
			readings: Array.map(current.records, record => ({
				...record,
				process: {
					...record.process,
					cpu: Option.getOrUndefined(
						Option.map(
							Option.filter(Option.fromUndefinedOr(known[record.process.pid]), value => value.start === record.start),
							value => value.process.cpu
						)
					)
				}
			}))
		}
	}
	return {baseline: current, readings: processUsage(current, previous?.baseline)}
}

export function attachProcesses(
	items: readonly InventoryItem[],
	records: readonly {cgroup: string; process: NonNullable<InventoryItem['processes']>[number]}[]
) {
	const owners = Array.groupBy(records, record => processOwner(record.cgroup))
	return Array.map(items, item => ({
		...item,
		processes: Array.map(
			Boolean.match(item.kind === 'service' || item.kind === 'container', {
				onFalse: () => [],
				onTrue: () => owners[itemOwner(item)] ?? []
			}),
			record => record.process
		)
	}))
}

// Each owner's memory and CPU, summed over its processes, for the metrics history.
export function ownerUsage(records: readonly {cgroup: string; process: Process}[]) {
	return Array.map(
		// Only owners an app row can name, and that hold at least 1 MiB, ride along with every sample.
		Array.filter(
			Record.toEntries(Array.groupBy(records, record => processOwner(record.cgroup))),
			entry =>
				!String.endsWith(':')(entry[0]) &&
				Array.reduce(entry[1], 0, (sum, record) => sum + record.process.memory) >= 1024 ** 2
		),
		entry => {
			const [id, group] = entry
			const cpus = Array.getSomes(Array.map(group, record => Option.fromUndefinedOr(record.process.cpu)))
			return {
				...Boolean.match(Array.isReadonlyArrayNonEmpty(cpus), {
					onFalse: () => ({}),
					onTrue: () => ({
						cpu: Number.round(
							Array.reduce(cpus, 0, (sum, cpu) => sum + cpu),
							2
						)
					})
				}),
				id,
				memory: Number.round(Array.reduce(group, 0, (sum, record) => sum + record.process.memory) / 1024, 0) * 1024
			}
		}
	)
}
