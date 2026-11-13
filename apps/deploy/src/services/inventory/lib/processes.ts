import {
	Array,
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

import {commandLabel} from './command.ts'

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

const SECRET = /(?:token|secret|passw(?:or)?d|key|auth|credential|cookie|session)/iu
const PROCESS_INTERVAL = Duration.seconds(2)

export type ProcessReading = {
	owner: Option.Option<AppId>
	process: Process
	// Linux reports time since boot; ps on macOS reports an absolute start instant.
	start: Duration.Duration | DateTime.Utc
	ticks: Duration.Duration
}

export type ProcessMeasurement = {records: readonly ProcessReading[]; time: DateTime.Utc; total: Duration.Duration}

function processStatus(status: string) {
	const values = Record.fromEntries(
		pipe(
			String.trim(status),
			String.split('\n'),
			Array.map(line => {
				const at = Option.getOrThrow(String.indexOf(':')(line))
				return [String.slice(0, at)(line), String.trim(String.slice(at + 1)(line))] as const
			})
		)
	)
	return {
		memory: Schema.decodeSync(ResidentMemoryFromKiB)(String.split(values['VmRSS'] ?? '', /\s+/u)[0] || '0'),
		name: values['Name'] ?? '',
		parent: Schema.decodeSync(ProcessIdFromString)(values['PPid'] ?? ''),
		pid: Schema.decodeSync(ProcessIdFromString)(values['Pid'] ?? '')
	}
}

// What a process was started with, as its arguments: flags and variables named like secrets, the value after such a flag, long opaque strings and URL credentials are masked, and each argument and their number are capped.
function commandArgs(cmdline: string) {
	const args = pipe(cmdline, String.split('\0'), Array.filter(String.isNonEmpty), Array.take(40))
	return Array.map(args, (arg, index) => {
		if (Option.isSome(String.match(/^-{0,2}[\w.-]+=/u)(arg)) && SECRET.test(String.split(arg, '=')[0])) {
			return `${String.split(arg, '=')[0]}=…`
		}
		// A secret flag's separate value, or a long opaque argument; the executable and flags themselves stay readable.
		const previous = args[index - 1] ?? ''
		const secretValue = String.startsWith('-')(previous) && !String.includes('=')(previous) && SECRET.test(previous)
		const opaque = !String.startsWith('/')(arg) && Option.isSome(String.match(/^[\w+/=-]{32,}$/u)(arg))
		if (index > 0 && (secretValue || (!String.startsWith('-')(arg) && opaque))) return '…'
		return String.slice(0, 200)(String.replaceAll(/:\/\/[^/@\s]+@/gu, '://…@')(arg))
	})
}

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
						// A process whose arguments can't be read still counts, without its preview.
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
								command,
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
	return pipe(
		previous,
		Option.filter(
			cached =>
				DateTime.isGreaterThanOrEqualTo(current.time, cached.baseline.time) &&
				pipe(cached.baseline.time, DateTime.distance(current.time), Duration.isLessThan(PROCESS_INTERVAL))
		),
		Option.match({
			onNone: () => ({
				baseline: current,
				readings: processUsage(
					current,
					Option.map(previous, cached => cached.baseline)
				)
			}),
			onSome: cached => {
				const known = HashMap.fromIterable(Array.map(cached.readings, record => [record.process.pid, record] as const))
				return {
					baseline: cached.baseline,
					readings: Array.map(current.records, record => {
						const process: Process = {
							...record.process,
							cpu: pipe(
								HashMap.get(known, record.process.pid),
								Option.filter(value => Equal.equals(value.start, record.start)),
								Option.flatMap(value => value.process.cpu)
							)
						}
						return {...record, process}
					})
				}
			}
		})
	)
}

// A Mac's processes that descend from a Deslop launch agent, from `ps -axww -o pid=,ppid=,rss=,time=,lstart=,args=` in the C locale, keyed like `processOwner` by the agent they run under; `agents` names each agent's PID. Times are milliseconds: `ticks` of CPU, and `start` as an identity that tells a reused PID apart.
export function launchdProcesses(text: string, agents: HashMap.HashMap<ProcessId, UnitId>) {
	const rows = Array.getSomes(
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
	const parents = HashMap.fromIterable(Array.map(rows, row => [row.pid, row.parent] as const))
	function agent(pid: ProcessId): Option.Option<UnitId> {
		return pipe(
			agents,
			HashMap.get(pid),
			Option.orElse(() =>
				Option.flatMap(
					pipe(
						parents,
						HashMap.get(pid),
						Option.filter(parent => parent !== pid)
					),
					agent
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
									Duration.hours(Option.getOrElse(fields[1], () => 0)),
									Duration.sum(Duration.minutes(fields[2])),
									Duration.sum(Duration.seconds(fields[3]))
								)
							),
							Option.filter(Duration.isFinite)
						)
					}),
					times => {
						const command = commandArgs(pipe(String.trim(row.args), String.split(/\s+/u), Array.join('\0')))
						return {
							owner: Option.some(AppId.make(`service:user:${unit}`)),
							process: Process.make({
								command: Option.some(command),
								cpu: Option.none(),
								label: commandLabel(command, Option.none()),
								memory: row.memory,
								name: pipe(
									Array.head(command),
									Option.flatMap(head => Array.last(String.split(head, '/'))),
									Option.getOrElse(() => '')
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
