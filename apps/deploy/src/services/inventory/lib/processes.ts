import {Array, Boolean, Clock, DateTime, Effect, FileSystem, Number, Option, Record, Schema, String, pipe} from 'effect'

import {commandLabel} from './command.ts'

import {itemOwner, processOwner} from '#services/inventory/lib/utils.ts'
import {DeployError} from '#services/inventory/schema.ts'
import type {InventoryItem, Process} from '#services/inventory/schema.ts'

const PROCESS_INTERVAL = 2000
const SECRET = /(?:token|secret|passw(?:or)?d|key|auth|credential|cookie|session)/iu

function processStatus(status: string) {
	const values = Record.fromEntries(
		pipe(String.trim(status), String.split('\n'), Array.map(line => {
			const at = Option.getOrElse(String.indexOf(':')(line), () => -1)
			return [String.slice(0, at)(line), String.trim(String.slice(at + 1)(line))] as const
		}))
	)
	return {
		memory: Schema.decodeSync(Schema.FiniteFromString)(String.split(values['VmRSS'] ?? '', /\s+/u)[0] || '0') * 1024,
		name: values['Name'] ?? '',
		parent: Schema.decodeSync(Schema.FiniteFromString.check(Schema.isInt()))(values['PPid'] ?? ''),
		pid: Schema.decodeSync(Schema.FiniteFromString.check(Schema.isInt()))(values['Pid'] ?? '')
	}
}

// What a process was started with, as its arguments: flags and variables named like secrets, the value after such a flag, long opaque strings and URL credentials are masked, and each argument and their number are capped.
function commandArgs(cmdline: string) {
	const args = pipe(cmdline, String.split('\0'), pipelineSubject1431 => Array.filter(pipelineSubject1431, String.isNonEmpty), Array.take(40))
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
	const counts = yield* Schema.decodeEffect(Schema.Array(Schema.FiniteFromString))(
		pipe(String.trim(String.split(yield* fs.readFileString('/proc/stat'), '\n')[0]), String.split(/\s+/u), Array.drop(1), Array.take(8))
	)
	const total = Number.sumAll(counts)
	const records = yield* pipe(yield* fs.readDirectory('/proc'), Array.filter(name => Option.isSome(String.match(/^[0-9]+$/u)(name))), pipelineSubject2683 => Effect.forEach(pipelineSubject2683, pid =>
				pipe(
					Effect.gen(function* () {
						const status = yield* fs.readFileString(`/proc/${pid}/status`)
						const stat = yield* fs.readFileString(`/proc/${pid}/stat`)
						const cwd = yield* Effect.option(fs.readLink(`/proc/${pid}/cwd`))
						// A process whose arguments can't be read still counts, without its preview.
						const command = Option.map(yield* Effect.option(fs.readFileString(`/proc/${pid}/cmdline`)), commandArgs)
						const fields = String.split(
							String.slice(Option.getOrElse(String.lastIndexOf(')')(stat), () => -1) + 2)(stat),
							/\s+/u
						)
						const parsed = yield* Effect.try({
							catch: cause => DeployError.make({cause, message: `Process ${pid} has an unreadable status.`}),
							try: () => processStatus(status)
						})
						return {
							owner: processOwner(yield* fs.readFileString(`/proc/${pid}/cgroup`)),
							process: {
								...parsed,
								...Option.match(command, {onNone: () => ({}), onSome: args => ({command: args})}),
								// The label reads the masked arguments; a kernel thread or a zombie has none, so its name stands alone.
								label: Option.match(Option.filter(command, Array.isReadonlyArrayNonEmpty), {
									onNone: () => ({detail: '', name: parsed.name}),
									onSome: args => commandLabel(args, cwd)
								})
							},
							start: yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[19] ?? ''),
							ticks:
								(yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[11] ?? '')) +
								(yield* Schema.decodeEffect(Schema.FiniteFromString)(fields[12] ?? ''))
						}
					}),
					Effect.option
				), {concurrency: 16}), pipelineSubject2672 => Effect.map(pipelineSubject2672, Array.getSomes))
	return {records, time: yield* Clock.currentTimeMillis, total}
})

function processUsage(current: Effect.Success<typeof processes>, previous?: Effect.Success<typeof processes>) {
	const known = Record.fromEntries(Array.map(previous?.records ?? [], record => [`${record.process.pid}`, record]))
	return Array.map(current.records, record => {
		const old = known[record.process.pid]
		const elapsed = current.total - (previous?.total ?? current.total)
		const process: Process = {
			...record.process,
			...Record.getSomes({
				cpu: pipe(Option.fromUndefinedOr(old), Option.filter(value =>
							value.start === record.start &&
							elapsed > 0 &&
							record.ticks >= value.ticks &&
							current.time - (previous?.time ?? current.time) >= PROCESS_INTERVAL &&
							current.time - (previous?.time ?? 0) <= 90_000), Option.map(value => Number.clamp(((record.ticks - value.ticks) / elapsed) * 100, {maximum: 100, minimum: 0})))
			})
		}
		return {...record, process}
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
			readings: Array.map(current.records, record => {
				const process: Process = {
					...record.process,
					...Record.getSomes({
						cpu: pipe(Option.fromUndefinedOr(known[record.process.pid]), Option.filter(value => value.start === record.start), Option.flatMap(value => Option.fromUndefinedOr(value.process.cpu)))
					})
				}
				return {...record, process}
			})
		}
	}
	return {baseline: current, readings: processUsage(current, previous?.baseline)}
}

// A Mac's processes that descend from a Deslop launch agent, from `ps -axww -o pid=,ppid=,rss=,time=,lstart=,args=` in the C locale, keyed like `processOwner` by the agent they run under; `agents` names each agent's PID. Times are milliseconds: `ticks` of CPU, and `start` as an identity that tells a reused PID apart.
export function launchdProcesses(text: string, agents: Record<string, string>) {
	const rows = Array.getSomes(
		pipe(text, String.split('\n'), Array.map(line =>
			Option.map(
				String.match(/^\s*([0-9]+)\s+([0-9]+)\s+([0-9]+)\s+(\S+)\s+(\S+\s+\S+\s+\S+\s+\S+\s+\S+)\s+(.*)$/u)(line),
				match => ({
					args: match[6] ?? '',
					cpu: match[4] ?? '',
					memory: match[3] ?? '',
					parent: match[2] ?? '',
					pid: match[1] ?? '',
					start: match[5] ?? ''
				})
			)))
	)
	const parents = Record.fromEntries(Array.map(rows, row => [row.pid, row.parent] as const))
	function agent(pid: string): Option.Option<string> {
		return pipe(agents, pipelineSubject7403 => Record.get(pipelineSubject7403, pid), Option.orElse(() =>
			pipe(parents, pipelineSubject7517 => Record.get(pipelineSubject7517, pid), Option.filter(parent => parent !== pid), pipelineSubject7483 => Option.flatMap(pipelineSubject7483, agent))))
	}
	return Array.getSomes(
		Array.map(rows, row =>
			Option.flatMap(agent(row.pid), unit =>
				Option.map(Option.all({
						start: Option.map(DateTime.make(row.start), DateTime.toEpochMillis),
						ticks: Option.map(
							String.match(/^(?:([0-9]+):)?([0-9]+):([0-9]+(?:\.[0-9]+)?)$/u)(row.cpu),
							match =>
								((Option.getOrElse(Number.parse(match[1] ?? ''), () => 0) * 60 +
									Option.getOrElse(Number.parse(match[2] ?? ''), () => 0)) *
									60 +
									Option.getOrElse(Number.parse(match[3] ?? ''), () => 0)) *
								1000
						)
					}), times => {
						const command = commandArgs(pipe(String.trim(row.args), String.split(/\s+/u), Array.join('\0')))
						return {
							...times,
							owner: `service:user:${unit}`,
							process: {
								command,
								label: commandLabel(command, Option.none()),
								memory: Schema.decodeSync(Schema.FiniteFromString)(row.memory) * 1024,
								name: pipe(Array.head(command), Option.flatMap(head => Array.last(String.split(head, '/'))), Option.getOrElse(() => '')),
								parent: Schema.decodeSync(Schema.FiniteFromString.check(Schema.isInt()))(row.parent),
								pid: Schema.decodeSync(Schema.FiniteFromString.check(Schema.isInt()))(row.pid)
							},
							unit
						}
					})
			)
		)
	)
}

export function attachProcesses(
	items: readonly InventoryItem[],
	records: readonly {owner: string; process: NonNullable<InventoryItem['processes']>[number]}[]
) {
	const owners = Array.groupBy(records, record => record.owner)
	return Array.map(items, item => ({
		...item,
		processes: pipe(item.kind === 'service' || item.kind === 'container', pipelineSubject9171 => Boolean.match(pipelineSubject9171, {
				onFalse: () => [],
				onTrue: () => owners[itemOwner(item)] ?? []
			}), Array.map(record => record.process))
	}))
}
