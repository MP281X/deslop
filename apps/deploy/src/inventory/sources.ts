import {
	Array,
	Boolean,
	Cache,
	Context,
	DateTime,
	Duration,
	Effect,
	Equal,
	Exit,
	FileSystem,
	Filter,
	Function,
	HashMap,
	HashSet,
	Number,
	Option,
	Record,
	Schema,
	SchemaGetter,
	String,
	Tracer,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpTraceContext} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'

import {executeProcess} from '@deslop/runtime/server/process'

import {DeployError} from '#contracts'

import {InventoryItem, ItemId, Process, ProcessIdFromString, Timer, UnitId} from './contract.ts'
import type {AppId, ProcessId, ServiceScope} from './contract.ts'
import {commandLabel, maskArguments} from './labels.ts'
import {appUnitName, ownedUnits, probeSocket, socketLine, socketUnit, unitFailures} from './parse.ts'

// A command that hangs is killed within its source's ten seconds; optional metadata names a shorter wait so a stall drops only itself.
export function commandRunner(spawner: ChildProcessSpawner.ChildProcessSpawner['Service']) {
	return function command(name: string, args: string[], timeout: Duration.Input = '10 seconds') {
		return pipe(
			executeProcess(name, args, {timeout}),
			Effect.mapError(cause =>
				DeployError.make({cause, message: `Could not run ${name}; inspect Deploy's process logs.`})
			),
			Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
		)
	}
}

export type Command = ReturnType<typeof commandRunner>

type Unit = typeof Unit.Type
const Unit = Schema.Struct({active: Schema.String, description: Schema.String, sub: Schema.String, unit: UnitId})

// A JSON listing whose malformed rows are skipped, while an unreadable listing fails.
function systemctlRows<A>(command: Command, args: string[], row: Schema.Decoder<A>) {
	return pipe(
		command('systemctl', args),
		Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))),
		Effect.map(rows => Array.getSomes(Array.map(rows, item => Schema.decodeUnknownOption(row)(item))))
	)
}

// The units of these names that are owned apps.
export function appDetails(command: Command, names: readonly UnitId[]) {
	return Effect.map(
		command(
			'systemctl',
			['--user', 'show', '--all', '--property=Id,LoadState,Slice,TriggeredBy,Type', '--', ...names],
			'3 seconds'
		),
		ownedUnits
	)
}

export const units = Effect.fnUntraced(function* (command: Command, system: boolean) {
	const scope = Boolean.match(system, {
		onFalse: Function.constant('user' as const),
		onTrue: Function.constant('system' as const)
	})
	const scopeFlags = Boolean.match(system, {onFalse: () => ['--user'], onTrue: () => []})
	// Each systemctl call costs a few hundred milliseconds, so the timers and units are read side by side.
	const listed = yield* Effect.all(
		{
			rows: systemctlRows(
				command,
				[...scopeFlags, 'list-units', '--all', '--type=service', '--output=json', '--no-pager'],
				Unit
			),
			timers: systemctlRows(command, [...scopeFlags, 'list-timers', '--all', '--output=json', '--no-pager'], Timer)
		},
		{concurrency: 'unbounded'}
	)
	const scheduled = HashMap.fromIterable(
		Array.getSomes(
			Array.map(listed.timers, timer =>
				Option.map(
					timer.activates,
					unit => [unit, Option.map(timer.next, next => DateTime.mapEpochMillis(next, Math.floor))] as const
				)
			)
		)
	)
	const failed = pipe(
		listed.rows,
		Array.filter(row => row.active === 'failed'),
		Array.map(row => row.unit)
	)
	const owned = yield* Array.match(
		pipe(
			listed.rows,
			Array.map(row => row.unit),
			Array.filter(name => !system && appUnitName(name) && !HashMap.has(scheduled, name))
		),
		{
			onEmpty: () => Effect.succeed(HashSet.empty<UnitId>()),
			onNonEmpty: Effect.fnUntraced(function* (names) {
				return yield* Effect.catch(appDetails(command, names), cause =>
					Effect.as(Effect.logWarning('App ownership could not be read', cause), HashSet.empty<UnitId>())
				)
			})
		}
	)
	// Optional failure diagnostics accompany the listed description and failed state; an unreadable reason leaves the diagnostic absent.
	const failures = Option.getOrElse(
		Option.flatten(
			yield* pipe(
				command(
					'systemctl',
					[
						...scopeFlags,
						'show',
						...failed,
						'-p',
						'Id,ActiveState,Result,ExecMainCode,ExecMainStatus,StateChangeTimestamp',
						'--timestamp=unix'
					],
					'3 seconds'
				),
				Effect.map(unitFailures),
				Effect.option,
				Effect.when(Effect.succeed(Array.isReadonlyArrayNonEmpty(failed)))
			)
		),
		() => unitFailures('')
	)
	return Array.map(listed.rows, row =>
		InventoryItem.make({
			active: row.active === 'active',
			detail: `${scope} · ${row.description}`,
			failure: Record.get(failures, row.unit),
			health: Boolean.match(row.active === 'failed', {
				onFalse: Function.constant('quiet' as const),
				onTrue: Function.constant('error' as const)
			}),
			id: ItemId.make(`${scope}:${row.unit}`),
			kind: 'service',
			name: row.unit,
			next: Option.flatten(HashMap.get(scheduled, row.unit)),
			owned: Option.liftPredicate(true, () => HashSet.has(owned, row.unit)),
			running:
				row.active === 'activating' ||
				row.active === 'deactivating' ||
				(row.active === 'active' && row.sub === 'running'),
			scheduled: pipe(scheduled, HashMap.get(row.unit), Option.map(Function.constTrue)),
			scope: Option.some(scope),
			state: Boolean.match(row.active === 'active', {
				onFalse: () => `${row.active} · ${row.sub}`,
				onTrue: () => row.sub
			}),
			url: Option.none()
		})
	)
})

type Probe = (port: number, identity: string) => Effect.Effect<Option.Option<{http: boolean; ui: boolean}>>

// Whether a listener answers HTTP and serves a page.
const makeProbe = Effect.fnUntraced(function* (http: HttpClient.HttpClient) {
	// A refused or timed-out HEAD is a negative protocol probe, not a replacement for a required collector read.
	function head(port: number) {
		return pipe(
			http.head(`http://127.0.0.1:${port}/`, {
				headers: HttpTraceContext.toHeaders(
					new Tracer.NativeSpan({
						annotations: Context.empty(),
						kind: 'internal',
						links: [],
						name: 'Deploy.probe',
						parent: Option.none(),
						sampled: false,
						startTime: 0n
					})
				)
			}),
			Effect.map(value => ({
				http: true,
				ui:
					value.status >= 200 && value.status < 400 && String.includes('text/html')(value.headers['content-type'] ?? '')
			})),
			Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'manual'}),
			Effect.provideService(HttpClient.TracerDisabledWhen, Function.constTrue),
			Effect.timeout(Duration.millis(700)),
			Effect.option
		)
	}
	// A process that keeps its PID can still change what it serves, so an answer is asked again after ten minutes.
	const probes = yield* Cache.makeWith((key: readonly [number, string]) => head(key[0]), {
		capacity: 1024,
		timeToLive: exit =>
			Boolean.match(Exit.isSuccess(exit) && Option.isSome(exit.value), {
				onFalse: () => Duration.seconds(5),
				onTrue: () => Duration.minutes(10)
			})
	})
	return function probe(port: number, identity: string) {
		// Without a readable start time a reused PID cannot be distinguished, so do not cache it.
		if (identity === '') return head(port)
		return Cache.get(probes, [port, identity])
	}
})

// Each listener with its unit, the app a Node listener's working directory names, and whether it answers HTTP. A PID whose start time changed while it was read was reused, so its listener keeps none of what was read.
function portItems(
	sockets: readonly Option.Option.Value<ReturnType<typeof socketLine>>[],
	probe: Probe,
	source: {
		readonly cwd: (pid: ProcessId) => Effect.Effect<Option.Option<string>>
		readonly owner: (pid: ProcessId) => Effect.Effect<Option.Option<{scope: ServiceScope; unit: UnitId}>>
		readonly start: (pid: ProcessId) => Effect.Effect<Option.Option<string>>
	}
) {
	return Effect.gen(function* () {
		const metadata = HashMap.fromIterable(
			yield* pipe(
				Array.getSomes(Array.map(sockets, socket => socket.process)),
				Array.dedupeWith((left, right) => left.pid === right.pid),
				Effect.forEach(
					Effect.fnUntraced(function* (process) {
						const start = yield* source.start(process.pid)
						const read = {
							cwd: yield* Boolean.match(String.startsWith('node')(process.name), {
								onFalse: () => Effect.succeedNone,
								onTrue: () => source.cwd(process.pid)
							}),
							owner: yield* source.owner(process.pid),
							start
						}
						if (Option.isNone(start) || !Equal.equals(start, yield* source.start(process.pid))) {
							return [
								process.pid,
								{cwd: Option.none<string>(), owner: Option.none(), start: Option.none<string>()}
							] as const
						}
						return [process.pid, read] as const
					}),
					{concurrency: 8}
				)
			)
		)
		return yield* Effect.forEach(
			sockets,
			Effect.fnUntraced(function* (socket) {
				const origin = Option.flatMap(socket.process, process => HashMap.get(metadata, process.pid))
				const owner = Option.flatMap(origin, process => process.owner)
				const process = Option.flatMap(socket.process, match => {
					if (!String.startsWith('node')(match.name)) return Option.liftPredicate(match.name, String.isNonEmpty)
					return pipe(
						Option.flatMap(origin, reading => reading.cwd),
						Option.match({
							onNone: () => match.name,
							onSome: cwd =>
								Option.match(String.match(/\/apps\/([^/]+)(?:\/|$)/u)(cwd), {
									onNone: () => match.name,
									onSome: app => app[1] ?? ''
								})
						}),
						Option.liftPredicate(String.isNonEmpty)
					)
				})
				const response = yield* Boolean.match(probeSocket(socket, Option.getOrElse(process, Function.constant(''))), {
					onFalse: () => Effect.succeed(Option.none<{http: boolean; ui: boolean}>()),
					onTrue: () =>
						probe(
							socket.port,
							Option.match(socket.process, {
								onNone: Function.constant(''),
								onSome: listener =>
									pipe(
										origin,
										Option.flatMap(value => value.start),
										Option.match({onNone: Function.constant(''), onSome: start => `${listener.pid}:${start}`})
									)
							})
						)
				})
				return InventoryItem.make({
					address: Option.some(socket.address),
					detail: `${socket.address} · ${Option.getOrElse(process, Function.constant('process unavailable'))}`,
					http: Option.some(Option.exists(response, value => value.http)),
					id: ItemId.make(`port:${socket.protocol}:${socket.address}`),
					kind: 'port',
					name: socket.address,
					port: Option.some(socket.port),
					process,
					protocol: Option.some(
						Boolean.match(socket.protocol === 'udp', {
							onFalse: Function.constant('tcp' as const),
							onTrue: Function.constant('udp' as const)
						})
					),
					scope: Option.map(owner, found => found.scope),
					state: socket.state,
					ui: Option.some(Option.exists(response, value => value.ui)),
					unit: Option.map(owner, found => found.unit),
					url: Option.none()
				})
			}),
			{concurrency: 8}
		)
	})
}

// The listening sockets `ss` lists, with each one's owner read from /proc.
export function makeListeners(command: Command, fs: FileSystem.FileSystem, http: HttpClient.HttpClient) {
	return Effect.map(makeProbe(http), probe =>
		Effect.flatMap(command('ss', ['-H', '-lntup']), text =>
			portItems(Array.getSomes(pipe(String.trim(text), String.split('\n'), Array.map(socketLine))), probe, {
				cwd: processId => Effect.option(fs.readLink(`/proc/${processId}/cwd`)),
				owner: processId =>
					Effect.map(Effect.option(fs.readFileString(`/proc/${processId}/cgroup`)), cgroup =>
						socketUnit(Option.getOrElse(cgroup, Function.constant('')))
					),
				start: processId =>
					Effect.map(
						Effect.option(fs.readFileString(`/proc/${processId}/stat`)),
						Option.flatMap(stat =>
							Option.flatMap(String.lastIndexOf(')')(stat), at =>
								pipe(String.slice(at + 2)(stat), String.split(/\s+/u), Array.get(19))
							)
						)
					)
			})
		)
	)
}

type CpuTicks = typeof CpuTicks.Type
const CpuTicks = Schema.Array(Schema.FiniteFromString)

type ResidentMemoryFromKiB = typeof ResidentMemoryFromKiB.Type
const ResidentMemoryFromKiB = pipe(
	Schema.FiniteFromString,
	Schema.decodeTo(Schema.Finite, {
		decode: SchemaGetter.transform(value => value * 1024),
		encode: SchemaGetter.transform(value => value / 1024)
	})
)

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
export const processes = Effect.fnUntraced(function* (ownerOf: (cgroup: string) => Option.Option<AppId>) {
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
						const owner = yield* Effect.fromOption(ownerOf(yield* fs.readFileString(`/proc/${pid}/cgroup`)))
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
							owner: Option.some(owner),
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
