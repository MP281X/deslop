import {
	Array,
	Filter,
	Boolean,
	DateTime,
	Duration,
	Effect,
	Equal,
	FileSystem,
	HashMap,
	Number,
	Option,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {commandLabel, maskArguments} from './command.ts'

import {itemOwner, processOwner} from '#services/inventory/lib/utils.ts'
import {CpuTicks, DeployError, Process, ProcessIdFromString, ResidentMemoryFromKiB} from '#services/inventory/schema.ts'
import type {AppId, InventoryItem} from '#services/inventory/schema.ts'

const PROCESS_INTERVAL = Duration.seconds(2)

export type ProcessReading = {
	owner: Option.Option<AppId>
	process: Process
	// Time since boot.
	start: Duration.Duration
	ticks: Duration.Duration
}

export type ProcessMeasurement = {records: readonly ProcessReading[]; time: DateTime.Utc; total: Duration.Duration}

// Linux omits VmRSS for kernel threads and zombies, which own no resident userspace memory; a missing or empty Pid or PPid fails the reading.
function processStatus(status: string) {
	const values = pipe(
		String.trim(status),
		String.split('\n'),
		Array.filterMap(
			Filter.fromPredicateOption(line =>
				Option.map(
					String.indexOf(':')(line),
					at => [String.slice(0, at)(line), String.trim(String.slice(at + 1)(line))] as const
				)
			)
		),
		Record.fromEntries
	)
	// A field Linux always prints; missing or empty, it decodes as nothing and fails.
	function field(name: string) {
		return pipe(Record.get(values, name), Option.filter(String.isNonEmpty), Option.getOrUndefined)
	}
	return {
		memory: Schema.decodeSync(ResidentMemoryFromKiB)(String.split(values['VmRSS'] ?? '', /\s+/u)[0] || '0'),
		name: values['Name'] ?? '',
		parent: Schema.decodeUnknownSync(ProcessIdFromString)(field('PPid')),
		pid: Schema.decodeUnknownSync(ProcessIdFromString)(field('Pid'))
	}
}

// Collector input permits vanished or unreadable individual processes to be skipped and optional metadata to be absent; whole-machine reads still fail.
export const processes = Effect.gen(function* () {
	const fs = yield* FileSystem.FileSystem
	const stat = yield* fs.readFileString('/proc/stat')
	const counts = yield* Schema.decodeEffect(CpuTicks)(
		pipe(String.trim(String.split(stat, '\n')[0]), String.split(/\s+/u), Array.drop(1), Array.take(8))
	)
	const total = Duration.millis(Number.sumAll(counts) * 10)
	const records = yield* pipe(
		yield* fs.readDirectory('/proc'),
		Array.filter(name => Option.isSome(String.match(/^[0-9]+$/u)(name))),
		Effect.forEach(
			pid =>
				Effect.option(
					Effect.gen(function* () {
						const status = yield* fs.readFileString(`/proc/${pid}/status`)
						const processStat = yield* fs.readFileString(`/proc/${pid}/stat`)
						const cwd = yield* Effect.option(fs.readLink(`/proc/${pid}/cwd`))
						// A process whose arguments can't be read still counts, labelled by its name. They are read only to label it, never sent: each is masked and their number capped.
						const command = Option.map(yield* Effect.option(fs.readFileString(`/proc/${pid}/cmdline`)), cmdline =>
							maskArguments(pipe(cmdline, String.split('\0'), Array.filter(String.isNonEmpty), Array.take(40)))
						)
						const fields = String.split(
							String.slice((yield* Effect.fromOption(String.lastIndexOf(')')(processStat))) + 2)(processStat),
							/\s+/u
						)
						const parsed = yield* Effect.try({
							catch: cause => DeployError.make({cause, message: `Process ${pid} has an unreadable status.`}),
							try: () => processStatus(status)
						})
						return {
							owner: processOwner(yield* fs.readFileString(`/proc/${pid}/cgroup`)),
							process: Process.make({
								...parsed,
								cpu: Option.none(),
								// The label reads the masked arguments; a kernel thread or a zombie has none, so its name stands alone.
								label: pipe(
									command,
									Option.filter(Array.isReadonlyArrayNonEmpty<string>),
									Option.match({
										onNone: () => ({detail: '', name: parsed.name}),
										onSome: args => commandLabel(args, cwd)
									})
								)
							}),
							start: Duration.millis((yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[19] ?? '')) * 10),
							ticks: Duration.millis(
								((yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[11] ?? '')) +
									(yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[12] ?? ''))) *
									10
							)
						}
					})
				),
			{concurrency: 16}
		),
		Effect.map(Array.getSomes)
	)
	return {records, time: yield* DateTime.now, total}
})

function processUsage(current: ProcessMeasurement, previous: Option.Option<ProcessMeasurement>) {
	const known = HashMap.fromIterable(
		pipe(
			previous,
			Option.match({onNone: () => [], onSome: old => old.records}),
			Array.map(record => [record.process.pid, record] as const)
		)
	)
	return Array.map(current.records, record => {
		const elapsed = Option.match(previous, {
			onNone: () => Duration.zero,
			onSome: old => Duration.subtract(current.total, old.total)
		})
		const process: Process = {
			...record.process,
			cpu: pipe(
				HashMap.get(known, record.process.pid),
				Option.filter(
					value =>
						Equal.equals(value.start, record.start) &&
						Duration.isGreaterThan(elapsed, Duration.zero) &&
						Duration.isGreaterThanOrEqualTo(record.ticks, value.ticks) &&
						Option.exists(
							previous,
							old =>
								pipe(old.time, DateTime.distance(current.time), Duration.isGreaterThanOrEqualTo(PROCESS_INTERVAL)) &&
								pipe(old.time, DateTime.distance(current.time), Duration.isLessThanOrEqualTo(Duration.seconds(90)))
						)
				),
				Option.map(value =>
					Number.clamp(
						(Duration.toMillis(Duration.subtract(record.ticks, value.ticks)) / Duration.toMillis(elapsed)) * 100,
						{maximum: 100, minimum: 0}
					)
				)
			)
		}
		return {...record, process}
	})
}

export function processReadings(
	current: ProcessMeasurement,
	previous: Option.Option<{
		baseline: ProcessMeasurement
		readings: readonly {start: ProcessReading['start']; process: Process}[]
	}>
) {
	return {
		baseline: current,
		readings: processUsage(
			current,
			Option.map(previous, cached => cached.baseline)
		)
	}
}

export function attachProcesses(
	items: readonly InventoryItem[],
	records: readonly {owner: Option.Option<AppId>; process: Process}[]
) {
	const owners = Array.groupBy(
		Array.getSomes(Array.map(records, record => Option.map(record.owner, owner => ({owner, process: record.process})))),
		record => record.owner
	)
	return Array.map(items, item => ({
		...item,
		processes: Option.some(
			pipe(
				item.kind === 'service' || item.kind === 'container',
				Boolean.match({onFalse: () => [], onTrue: () => owners[itemOwner(item)] ?? []}),
				Array.map(record => record.process)
			)
		)
	}))
}
