import {
	Array,
	Filter,
	Boolean,
	DateTime,
	Duration,
	Effect,
	Equal,
	FileSystem,
	Function,
	HashMap,
	MutableHashSet,
	Number,
	Option,
	Record,
	Schema,
	String,
	pipe
} from 'effect'

import {commandLabel, maskArguments} from './command.ts'

import {itemOwner, processOwner} from '#services/inventory/lib/utils.ts'
import {
	AppId,
	CpuTicks,
	CpuTime,
	DeployError,
	Process,
	ProcessIdFromString,
	ResidentMemoryFromKiB
} from '#services/inventory/schema.ts'
import type {InventoryItem, UnitId, ProcessId} from '#services/inventory/schema.ts'

const PROCESS_INTERVAL = Duration.seconds(2)

export type ProcessReading = {
	owner: Option.Option<AppId>
	process: Process
	// Linux reports time since boot; ps on macOS reports an absolute start instant.
	start: Duration.Duration | DateTime.Utc
	ticks: Duration.Duration
}

export type ProcessMeasurement = {records: readonly ProcessReading[]; time: DateTime.Utc; total: Duration.Duration}

// judge-ignore no-silent-fallback -- Linux omits VmRSS for kernel threads and zombies, which own no resident userspace memory; a missing or empty Pid or PPid fails the reading.
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

// What a process was started with, read only to label it, never sent: each argument is masked and their number capped.
function commandArgs(cmdline: string) {
	return maskArguments(pipe(cmdline, String.split('\0'), Array.filter(String.isNonEmpty), Array.take(40)))
}

// judge-ignore no-silent-fallback -- collector input permits vanished or unreadable individual processes to be skipped and optional metadata to be absent; whole-machine reads still fail.
// judge-ignore no-unrelated-jobs -- whole-machine CPU ticks are the denominator for these process CPU readings; records, total and time form one measurement.
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
						// A process whose arguments can't be read still counts, labelled by its name.
						const command = Option.map(yield* Effect.option(fs.readFileString(`/proc/${pid}/cmdline`)), commandArgs)
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

// All readable rows from `ps -axww -o pid=,ppid=,rss=,time=,lstart=,args=` in the C locale.
function launchdRows(text: string) {
	return Array.getSomes(
		pipe(
			text,
			String.split('\n'),
			Array.map(line =>
				Option.flatMap(
					String.match(/^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+(\S+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/u)(line),
					match =>
						Option.map(
							Option.all({
								memory: Schema.decodeOption(ResidentMemoryFromKiB)(match[3] ?? ''),
								parent: Schema.decodeOption(ProcessIdFromString)(match[2] ?? ''),
								pid: Schema.decodeOption(ProcessIdFromString)(match[1] ?? '')
							}),
							fields => ({...fields, args: match[6] ?? '', cpu: match[4] ?? '', start: match[5] ?? ''})
						)
				)
			)
		)
	)
}

// Listener identities need all processes, including those outside a Dock app or launch agent.
export function launchdStarts(text: string) {
	return HashMap.fromIterable(Array.map(launchdRows(text), row => [row.pid, row.start] as const))
}

// Each process's executable path from `ps -axww -o pid=,comm=`, whose path is the only field after the PID.
export function launchdExecutables(text: string) {
	return HashMap.fromIterable(
		pipe(
			text,
			String.split('\n'),
			Array.map(line =>
				Option.flatMap(String.match(/^\s*([0-9]+)\s+(\/.*\S)\s*$/u)(line), match =>
					Option.map(Schema.decodeOption(ProcessIdFromString)(match[1] ?? ''), pid => [pid, match[2] ?? ''] as const)
				)
			),
			Array.getSomes
		)
	)
}

// A Mac's app-owned processes; agents names each app's PID, executables their paths, and start distinguishes a reused PID.
export function launchdProcesses(
	text: string,
	agents: HashMap.HashMap<ProcessId, UnitId>,
	executables: HashMap.HashMap<ProcessId, string>
) {
	const rows = launchdRows(text)
	const parents = HashMap.fromIterable(Array.map(rows, row => [row.pid, row.parent] as const))
	function agent(pid: ProcessId, visited = MutableHashSet.empty<ProcessId>()): Option.Option<UnitId> {
		if (MutableHashSet.has(visited, pid)) return Option.none()
		MutableHashSet.add(visited, pid)
		return pipe(
			agents,
			HashMap.get(pid),
			Option.orElse(() =>
				pipe(
					parents,
					HashMap.get(pid),
					Option.flatMap(parent => agent(parent, visited))
				)
			)
		)
	}
	return Array.getSomes(
		Array.map(rows, row =>
			Option.flatMap(agent(row.pid), unit =>
				Option.map(
					Option.all({
						start: DateTime.make(row.start),
						ticks: pipe(
							String.match(/^(?:([0-9]+):)?([0-9]+):([0-9]+(?:\.[0-9]+)?)$/u)(row.cpu),
							Option.flatMap(match =>
								Schema.decodeOption(CpuTime)({1: match[1], 2: match[2] ?? '', 3: match[3] ?? ''})
							),
							Option.map(fields =>
								pipe(
									Duration.hours(Option.getOrElse(fields[1], Function.constant(0))),
									Duration.sum(Duration.minutes(fields[2])),
									Duration.sum(Duration.seconds(fields[3]))
								)
							),
							Option.filter(Duration.isFinite)
						)
					}),
					times => {
						// ps joins the arguments with spaces, so an executable path that holds spaces is taken whole from its own listing.
						const args = String.trim(row.args)
						const command = commandArgs(
							pipe(
								executables,
								HashMap.get(row.pid),
								Option.filter(path => String.startsWith(path)(args)),
								Option.match({
									onNone: () => pipe(args, String.split(/\s+/u), Array.join('\0')),
									onSome: path =>
										pipe(
											String.slice(path.length)(args),
											String.trim,
											String.split(/\s+/u),
											Array.prepend(path),
											Array.join('\0')
										)
								})
							)
						)
						return {
							owner: Option.some(AppId.make(`service:user:${unit}`)),
							process: Process.make({
								cpu: Option.none(),
								label: commandLabel(command, Option.none()),
								memory: row.memory,
								name: pipe(
									Array.head(command),
									Option.flatMap(head => Array.last(String.split(head, '/'))),
									Option.getOrElse(Function.constant(''))
								),
								parent: row.parent,
								pid: row.pid
							}),
							start: times.start,
							ticks: times.ticks,
							unit
						}
					}
				)
			)
		)
	)
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
