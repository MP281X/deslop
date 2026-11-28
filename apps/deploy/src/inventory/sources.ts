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
	Filter,
	Function,
	HashMap,
	HashSet,
	Iterable,
	Match,
	Number,
	Option,
	Record,
	Schema,
	String,
	Tracer,
	pipe
} from 'effect'
import type {FileSystem} from 'effect'

import {FetchHttpClient, HttpClient, HttpTraceContext} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'

import {executeProcess} from '@deslop/runtime/server/process'

import {
	APP_LIFECYCLE_MESSAGES,
	AppId,
	AppLifecycleEvent,
	InventoryItem,
	ItemId,
	ProcessIdFromString,
	Timer,
	UnitId
} from './contract.ts'
import type {ProcessId, ServiceScope} from './contract.ts'
import {ipv4Reachable} from './workloads.ts'

import {DeployError} from '#machine/contract.ts'

const APP_UNIT = /^deslop-[a-z0-9-]+\.service$/u

const SIGNALS: Record<number, string> = {
	1: 'SIGHUP',
	2: 'SIGINT',
	6: 'SIGABRT',
	9: 'SIGKILL',
	11: 'SIGSEGV',
	15: 'SIGTERM'
}

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

function appUnitName(name: string) {
	return !String.endsWith('-update.service')(name) && Option.isSome(String.match(APP_UNIT)(name))
}

// The installer puts apps, not update jobs or helper services, in this slice.
// fallow-ignore-next-line unused-export -- Tests call this directly.
export function ownedUnits(text: string) {
	return pipe(
		String.trim(text),
		String.split(/\n\s*\n/u),
		Array.filterMap(
			Filter.fromPredicateOption(block => {
				const fields = Record.fromEntries(
					pipe(
						block,
						String.split('\n'),
						Array.filterMap(
							Filter.fromPredicateOption(line =>
								Option.map(
									String.indexOf('=')(line),
									at => [String.slice(0, at)(line), String.slice(at + 1)(line)] as const
								)
							)
						)
					)
				)
				const name = fields['Id'] ?? ''
				const type = fields['Type'] ?? ''
				return Option.liftPredicate(
					UnitId.make(name),
					unit =>
						appUnitName(unit) &&
						fields['LoadState'] === 'loaded' &&
						fields['Slice'] === 'deslop.slice' &&
						fields['TriggeredBy'] === '' &&
						type !== '' &&
						type !== 'oneshot'
				)
			})
		),
		HashSet.fromIterable
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

function failureReason(result: string, status: number, ran: boolean) {
	if (result === 'exit-code' && !ran) return 'Failed before starting'
	const signal = SIGNALS[status] ?? `signal ${status}`
	return pipe(
		Match.value(result),
		Match.when('exit-code', () =>
			Option.match(Option.fromUndefinedOr(SIGNALS[status - 128]), {
				onNone: () => `Exited with code ${status}`,
				onSome: name => `Exited with code ${status} (${name})`
			})
		),
		Match.when('signal', () => `Killed by ${signal}`),
		Match.when('core-dump', () => `Crashed with ${signal}`),
		Match.when('oom-kill', Function.constant('Killed for running out of memory')),
		Match.when('timeout', Function.constant('Timed out')),
		Match.when('watchdog', Function.constant('Stopped answering its watchdog')),
		Match.when('start-limit-hit', Function.constant('Restarted too often')),
		Match.orElse(() => `Failed: ${result}`)
	)
}

// Why each failed unit stopped and when, by unit, from `systemctl show -p Id,ActiveState,Result,ExecMainCode,ExecMainStatus,StateChangeTimestamp --timestamp=unix`. A unit that recovered between its listing and this read is no longer failed, so it has no reason.
// fallow-ignore-next-line unused-export -- Tests call this directly.
export function unitFailures(text: string) {
	return pipe(
		String.trim(text),
		String.split(/\n\s*\n/u),
		Array.filter(String.isNonEmpty),
		Array.flatMap(block => {
			const fields = pipe(
				block,
				String.split('\n'),
				Array.filter(String.includes('=')),
				Record.fromIterableWith(line => {
					const [key, ...value] = String.split(line, '=')
					return [key, Array.join(value, '=')] as const
				})
			)
			const id = fields['Id'] ?? ''
			const result = fields['Result'] ?? ''
			const status = Number.parse(fields['ExecMainStatus'] ?? '')
			if (
				!String.isNonEmpty(id) ||
				!String.isNonEmpty(fields['ExecMainCode'] ?? '') ||
				fields['ActiveState'] !== 'failed' ||
				!String.isNonEmpty(result) ||
				result === 'success'
			) {
				return []
			}
			return Option.match(status, {
				onNone: () => [],
				onSome: exitStatus => [
					[
						UnitId.make(id),
						{
							at: Option.map(Number.parse(String.replace(/^@/u, '')(fields['StateChangeTimestamp'] ?? '')), seconds =>
								DateTime.mapEpochMillis(DateTime.makeUnsafe(0), () => seconds * 1000)
							),
							// A unit whose start step failed never ran its main process, which leaves its code 0.
							reason: failureReason(result, exitStatus, fields['ExecMainCode'] !== '0')
						}
					] as const
				]
			})
		}),
		Record.fromEntries
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

// fallow-ignore-next-line unused-export -- Tests call this directly.
export function socketLine(line: string) {
	const fields = String.split(String.trim(line), /\s+/u)
	const address = fields[4] ?? ''
	const state = fields[1] ?? ''
	if (!Array.contains(['tcp', 'udp'], fields[0]) || !String.isNonEmpty(state) || !String.isNonEmpty(address)) {
		return Option.none()
	}
	return Option.map(Number.parse(Array.lastNonEmpty(String.split(address, ':'))), port => ({
		address,
		port,
		// A name may itself hold a quote; it ends at the quote before its pid.
		process: Option.flatMap(String.match(/users:\(\("(.+?)",pid=([0-9]+)/u)(line), match =>
			Option.map(Schema.decodeOption(ProcessIdFromString)(match[2] ?? ''), pid => ({name: match[1] ?? '', pid}))
		),
		protocol: fields[0],
		state
	}))
}

function probeSocket(listener: Option.Option.Value<ReturnType<typeof socketLine>>, process: string) {
	return (
		listener.protocol === 'tcp' &&
		listener.port >= 1024 &&
		ipv4Reachable(listener.address) &&
		Option.isNone(String.match(/^(?:postgres|redis|ssh|cloudflared|tailscaled|caddy)$/u)(process))
	)
}

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

// The service a cgroup path names, and whether a user manager runs it, so a user and a system unit of one name stay apart.
function socketUnit(cgroup: string) {
	return Option.map(
		Iterable.findLast(String.matchAll(/\/([^/]+\.service)(?=\/|\n|$)/gu)(cgroup), Function.constTrue),
		match => ({
			scope: Boolean.match(Option.isSome(String.match(/\/user@[0-9]+\.service\/.*\.service(?:\/|\n|$)/u)(cgroup)), {
				onFalse: Function.constant<ServiceScope>('system'),
				onTrue: Function.constant<ServiceScope>('user')
			}),
			unit: UnitId.make(match[1] ?? '')
		})
	)
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

export type AppAction = typeof AppAction.Type
const AppAction = Schema.Literals(['restart', 'stop'])

const [STARTED, , RESTART_SCHEDULED] = APP_LIFECYCLE_MESSAGES

export function appUnit(id: AppId) {
	return pipe(
		id,
		String.match(/^service:user:(.+)$/u),
		Option.flatMap(match => Array.get(match, 1)),
		Option.filter(appUnitName),
		Option.map(name => UnitId.make(name))
	)
}

export function ownedProcess(uid: number, cgroup: string) {
	return pipe(
		cgroup,
		String.match(/^0::\/user\.slice\/user-(\d+)\.slice\/user@(\d+)\.service\/deslop\.slice\/([^/\n]+)/u),
		Option.filter(match => match[1] === `${uid}` && match[2] === `${uid}`),
		Option.flatMap(match => Array.get(match, 3)),
		Option.filter(appUnitName),
		Option.map(unit => AppId.make(`service:user:${unit}`))
	)
}

// A completed start needs evidence of an earlier run in this boot. A stop or scheduled restart can supply it after the earlier start has rotated away.
export function restartTimes(text: string, after: DateTime.Utc, now: DateTime.Utc) {
	return pipe(
		text,
		String.split('\n'),
		Array.filterMap(Filter.fromPredicateOption(line => Schema.decodeOption(AppLifecycleEvent)(line))),
		Array.reduce(
			{boots: HashSet.empty<string>(), invocations: HashSet.empty<string>(), restarts: Array.empty<DateTime.Utc>()},
			(state, entry) => {
				const boots = HashSet.add(state.boots, entry._BOOT_ID)
				if (entry.MESSAGE_ID === RESTART_SCHEDULED) return {...state, boots}
				const id = entry.USER_INVOCATION_ID ?? ''
				if (id === '' || HashSet.has(state.invocations, id)) return state
				const time = DateTime.makeUnsafe(Math.floor(entry.__REALTIME_TIMESTAMP / 1000))
				if (
					entry.MESSAGE_ID === STARTED &&
					HashSet.has(state.boots, entry._BOOT_ID) &&
					DateTime.isGreaterThan(time, after) &&
					DateTime.isLessThanOrEqualTo(time, now)
				) {
					return {boots, invocations: HashSet.add(state.invocations, id), restarts: Array.append(state.restarts, time)}
				}
				return {...state, boots, invocations: HashSet.add(state.invocations, id)}
			}
		),
		state => state.restarts
	)
}
