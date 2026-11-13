import {cpus, hostname} from 'node:os'
import {pid, platform} from 'node:process'

import {
	Array,
	Boolean,
	DateTime,
	Duration,
	Context,
	Effect,
	FileSystem,
	Function,
	HashMap,
	Layer,
	Number,
	Option,
	Record,
	Ref,
	Result,
	Schedule,
	Schema,
	String,
	SubscriptionRef,
	Tracer,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpTraceContext} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'

import {executeProcess} from '@deslop/runtime/server/process'

import {exitFailure, unitFailures} from './lib/failures.ts'
import {launchAgents} from './lib/launchd.ts'
import {attachProcesses, launchdProcesses, processReadings, processes} from './lib/processes.ts'
import type {ProcessMeasurement} from './lib/processes.ts'
import {type Socket, lsofSockets, probeSocket, socketLine, socketProcess, socketUnit} from './lib/sockets.ts'

import {
	Container,
	DeployError,
	ExposureName,
	InventoryItem,
	ItemId,
	ProcessId,
	Serve,
	Tailnet,
	Timer,
	Unit,
	WorkerId
} from '#services/inventory/schema.ts'
import type {RunRequest, UnitId, Snapshot} from '#services/inventory/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly deployInventory: never
	}
}

// Each listener with its unit, the app a Node listener's working directory names, and whether it answers HTTP; `unit` and `cwd` read a PID the platform's way.
function portItems(
	sockets: readonly Socket[],
	worker: WorkerId,
	http: HttpClient.HttpClient,
	origin: {
		readonly cwd: (pid: ProcessId) => Effect.Effect<Option.Option<string>>
		readonly unit: (pid: ProcessId) => Effect.Effect<Option.Option<UnitId>>
	}
) {
	return Effect.forEach(
		sockets,
		Effect.fnUntraced(function* (socket) {
			const unit = yield* Option.match(socket.process, {
				onNone: () => Effect.succeedNone,
				onSome: match => origin.unit(match.pid)
			})
			const process = yield* Option.match(socket.process, {
				onNone: () => Effect.succeedNone,
				onSome: Effect.fnUntraced(function* (match) {
					if (!String.startsWith('node')(match.name)) return Option.liftPredicate(match.name, String.isNonEmpty)
					return pipe(
						yield* origin.cwd(match.pid),
						Option.match({onNone: () => match.name, onSome: cwd => socketProcess(match.name, cwd)}),
						Option.liftPredicate(String.isNonEmpty)
					)
				})
			})
			const response = yield* Boolean.match(probeSocket(socket, Option.getOrElse(process, Function.constant(''))), {
				onFalse: () => Effect.succeed(Option.none<{http: boolean; ui: boolean}>()),
				onTrue: Effect.fnUntraced(function* () {
					// The probe sends an unsampled trace context, so the app's HEAD span is never exported.
					return yield* pipe(
						http.head(`http://127.0.0.1:${socket.port}/`, {
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
								value.status >= 200 &&
								value.status < 400 &&
								String.includes('text/html')(value.headers['content-type'] ?? '')
						})),
						Effect.provideService(FetchHttpClient.RequestInit, {redirect: 'manual'}),
						// A probe expects refusals and 4xx from ports that aren't web pages, so it records no span.
						Effect.provideService(HttpClient.TracerDisabledWhen, Function.constTrue),
						Effect.timeout(Duration.millis(700)),
						Effect.option
					)
				})
			})
			return InventoryItem.make({
				address: Option.some(socket.address),
				detail: `${socket.address} · ${Option.getOrElse(process, Function.constant('process unavailable'))}`,
				http: Option.some(Option.exists(response, value => value.http)),
				id: ItemId.make(`${worker}:port:${socket.protocol}:${socket.address}`),
				kind: 'port',
				name: socket.address,
				port: Option.some(socket.port),
				process,
				protocol: Option.some(
					Boolean.match(socket.protocol === 'udp', {onFalse: () => 'tcp' as const, onTrue: () => 'udp' as const})
				),
				state: socket.state,
				ui: Option.some(Option.exists(response, value => value.ui)),
				unit,
				url: Option.none(),
				worker
			})
		}),
		{concurrency: 8}
	)
}

// What a worker's own collectors read: its sources, and its processes for the snapshot to attach by owner.
type Machine = {
	readonly processes: Effect.Effect<ProcessMeasurement, DeployError>
	readonly sources: readonly ReturnType<typeof collect<DeployError, never>>[]
}

function collect<E extends {readonly message: string}, R>(name: string, effect: Effect.Effect<InventoryItem[], E, R>) {
	return pipe(
		effect,
		Effect.timeout(Duration.seconds(10)),
		Effect.withSpan('Inventory.collect', {attributes: {source: name}}),
		Effect.match({
			onFailure: cause => ({items: Array.empty<InventoryItem>(), source: {error: Option.some(cause.message), name}}),
			onSuccess: items => ({items, source: {error: Option.none<string>(), name}})
		})
	)
}

export class Inventory extends Context.Service<
	Inventory,
	{
		readonly refresh: Effect.Effect<void>
		readonly run: (input: Omit<RunRequest, 'worker'>) => Effect.Effect<void, DeployError>
		readonly snapshot: Effect.Effect<Snapshot>
	}
>()('@deslop/deploy/services/inventory/service/Inventory') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const http = yield* HttpClient.HttpClient
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			function command(name: string, args: string[]) {
				return pipe(
					executeProcess(name, args),
					Effect.mapError(cause => DeployError.make({cause, message: cause.message})),
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
				)
			}
			const worker = yield* Schema.decodeEffect(WorkerId)(hostname())
			const selfProcess = yield* Schema.decodeEffect(ProcessId)(pid)
			const processState = yield* Ref.make(Option.none<ReturnType<typeof processReadings>>())
			const units = Effect.fnUntraced(function* (system: boolean) {
				const scope = Boolean.match(system, {onFalse: () => 'user' as const, onTrue: () => 'system' as const})
				const scopeFlags = Boolean.match(system, {onFalse: () => ['--user'], onTrue: () => []})
				const scheduled = HashMap.fromIterable(
					Array.getSomes(
						Array.map(
							yield* Effect.flatMap(
								command('systemctl', [...scopeFlags, 'list-timers', '--all', '--output=json', '--no-pager']),
								Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timer)))
							),
							timer =>
								Option.map(
									timer.activates,
									unit => [unit, Option.map(timer.next, next => DateTime.mapEpochMillis(next, Math.floor))] as const
								)
						)
					)
				)
				const rows = yield* Effect.flatMap(
					command('systemctl', [...scopeFlags, 'list-units', '--all', '--type=service', '--output=json', '--no-pager']),
					Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Unit)))
				)
				const failed = pipe(
					rows,
					Array.filter(row => row.active === 'failed'),
					Array.map(row => row.unit)
				)
				// Why each failed one stopped, in place of its description, which only repeats its command; an unreadable reason leaves the description.
				const failures = Option.getOrElse(
					Option.flatten(
						yield* pipe(
							command('systemctl', [
								...scopeFlags,
								'show',
								...failed,
								'-p',
								'Id,Result,ExecMainCode,ExecMainStatus,StateChangeTimestamp',
								'--timestamp=unix'
							]),
							Effect.map(unitFailures),
							Effect.option,
							Effect.when(Effect.succeed(Array.isReadonlyArrayNonEmpty(failed)))
						)
					),
					() => unitFailures('')
				)
				return Array.map(rows, row =>
					InventoryItem.make({
						active: row.active === 'active',
						detail: `${scope} · ${row.description}`,
						failure: Record.get(failures, row.unit),
						health: Boolean.match(row.active === 'failed', {
							onFalse: () => 'quiet' as const,
							onTrue: () => 'error' as const
						}),
						id: ItemId.make(`${worker}:${scope}:${row.unit}`),
						kind: 'service',
						name: row.unit,
						next: Option.flatten(HashMap.get(scheduled, row.unit)),
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
						url: Option.none(),
						worker
					})
				)
			})
			const docker = pipe(
				command('docker', ['ps', '--all', '--format', '{{json .}}']),
				Effect.flatMap(text =>
					pipe(
						text,
						String.split('\n'),
						Array.filter(String.isNonEmpty),
						Effect.forEach(line => Schema.decodeEffect(Schema.fromJsonString(Container))(line), {concurrency: 1})
					)
				),
				Effect.map(rows =>
					Array.map(rows, row =>
						InventoryItem.make({
							active: Array.contains(['running', 'restarting', 'paused'], row.State),
							bindings: Option.some([
								...Array.map(
									Array.fromIterable(
										String.matchAll(/traefik\.http\.services\.[^=,]+\.loadbalancer\.server\.port=([0-9]+)/gu)(
											Option.getOrElse(row.Labels, Function.constant(''))
										)
									),
									match => ({
										address: 'container',
										port: Option.getOrElse(Number.parse(match[1] ?? ''), Function.constant(0)),
										protocol: 'tcp' as const
									})
								),
								...Array.map(
									Array.fromIterable(String.matchAll(/((?:[0-9.]+|\[::\])):([0-9]+)->[0-9]+\/(tcp|udp)/gu)(row.Ports)),
									match => ({
										address: `${match[1]}:${match[2]}`,
										port: Option.getOrElse(Number.parse(match[2] ?? ''), Function.constant(0)),
										protocol: Boolean.match(match[3] === 'udp', {
											onFalse: () => 'tcp' as const,
											onTrue: () => 'udp' as const
										})
									})
								)
							]),
							detail: row.Status,
							health: Boolean.match(
								String.includes('unhealthy')(row.Status) || Option.isSome(String.match(/Exited \([1-9]/u)(row.Status)),
								{
									onFalse: () =>
										Boolean.match(row.State === 'restarting', {
											onFalse: () => 'quiet' as const,
											onTrue: () => 'warning' as const
										}),
									onTrue: () => 'error' as const
								}
							),
							id: ItemId.make(`${worker}:docker:${row.ID}`),
							kind: 'container',
							links: Option.some(
								Array.dedupe(
									Array.map(
										Array.fromIterable(
											String.matchAll(/Host\(`([^`]+)`\)/gu)(Option.getOrElse(row.Labels, Function.constant('')))
										),
										match => `https://${match[1]}`
									)
								)
							),
							name: row.Names,
							state: Boolean.match(String.includes('unhealthy')(row.Status), {
								onFalse: () => row.State,
								onTrue: Function.constant('unhealthy')
							}),
							url: Option.none(),
							worker
						})
					)
				)
			)
			// A Linux worker's systemd units, containers and listeners, and its processes from /proc, each owned by its cgroup.
			const linux = Effect.succeed<Machine>({
				processes: pipe(
					processes,
					Effect.provideService(FileSystem.FileSystem, fs),
					Effect.mapError(cause => DeployError.make({cause, message: cause.message}))
				),
				sources: [
					collect('User services', units(false)),
					collect('System services', units(true)),
					collect('Docker', docker),
					collect(
						'Listening ports',
						Effect.flatMap(command('ss', ['-H', '-lntup']), text =>
							portItems(
								Array.getSomes(pipe(String.trim(text), String.split('\n'), Array.map(socketLine))),
								worker,
								http,
								{
									cwd: processId => Effect.option(fs.readLink(`/proc/${processId}/cwd`)),
									unit: processId =>
										Effect.map(Effect.option(fs.readFileString(`/proc/${processId}/cgroup`)), cgroup =>
											socketUnit(Option.getOrElse(cgroup, Function.constant('')))
										)
								}
							)
						)
					)
				]
			})
			// A Mac's Deslop launch agents and listeners, and the processes under each agent, measured together so CPU shares compare like readings.
			const darwin: Effect.Effect<Machine> = Effect.gen(function* () {
				const launchd = yield* Effect.all(
					{
						agents: Effect.result(Effect.flatMap(command('launchctl', ['list']), launchAgents)),
						table: Effect.result(
							command('env', ['LC_ALL=C', 'ps', '-axww', '-o', 'pid=,ppid=,rss=,time=,lstart=,args='])
						)
					},
					{concurrency: 'unbounded'}
				)
				const time = yield* DateTime.now
				const total = Duration.millis(Number.sumAll(Array.flatMap(cpus(), cpu => Record.values(cpu.times))))
				const records = Result.map(launchd.table, text => {
					const agents = HashMap.fromIterable(
						Array.getSomes(
							pipe(
								launchd.agents,
								Result.getOrElse(() => []),
								Array.map(agent => Option.map(agent.pid, processId => [processId, agent.label] as const))
							)
						)
					)
					// Every descendant of this Mac's Deploy agent is a collector, including lsof and Tailscale subprocesses.
					return Array.filter(
						launchdProcesses(text, agents),
						record =>
							record.process.pid === selfProcess ||
							!pipe(agents, HashMap.get(selfProcess), Option.contains(record.unit))
					)
				})
				const owned = Result.getOrElse(records, Array.empty<Result.Result.Success<typeof records>[number]>)
				return {
					processes: Effect.map(Effect.fromResult(records), found => ({records: found, time, total})),
					sources: [
						collect(
							'Launch agents',
							Effect.map(Effect.fromResult(launchd.agents), agents =>
								Array.map(agents, agent =>
									InventoryItem.make({
										active: Option.isSome(agent.pid),
										detail: 'user · launch agent',
										failure: pipe(
											agent.status,
											Option.liftPredicate(status => Option.isNone(agent.pid) && status !== 0),
											Option.map(status => ({at: Option.none(), reason: exitFailure(status)}))
										),
										health: Boolean.match(Option.isNone(agent.pid) && agent.status !== 0, {
											onFalse: () => 'quiet' as const,
											onTrue: () => 'error' as const
										}),
										id: ItemId.make(`${worker}:user:${agent.label}`),
										kind: 'service',
										name: agent.label,
										running: Option.isSome(agent.pid),
										scope: Option.some('user'),
										state: Option.match(agent.pid, {
											onNone: () =>
												Boolean.match(agent.status === 0, {
													onFalse: Function.constant('failed · failed'),
													onTrue: Function.constant('inactive · dead')
												}),
											onSome: Function.constant('running')
										}),
										url: Option.none(),
										worker
									})
								)
							)
						),
						collect(
							'Listening ports',
							Effect.flatMap(command('lsof', ['-nP', '+c0', '-iTCP', '-sTCP:LISTEN', '-iUDP', '-F', 'pctPnT']), text =>
								portItems(lsofSockets(text), worker, http, {
									cwd: Effect.fnUntraced(function* (processId) {
										return pipe(
											yield* Effect.option(command('lsof', ['-nP', '-a', '-p', `${processId}`, '-d', 'cwd', '-Fn'])),
											Option.getOrElse(Function.constant('')),
											String.split('\n'),
											Array.findFirst(String.startsWith('n')),
											Option.map(String.slice(1))
										)
									}),
									unit: processId =>
										Effect.succeed(
											pipe(
												owned,
												Array.findFirst(record => record.process.pid === processId),
												Option.map(record => record.unit)
											)
										)
								})
							)
						)
					]
				}
			})
			// Only a service a timer starts, so the page can't start arbitrary units; system ones go through the workers' passwordless sudo. A Mac's launch agents are apps, never timer jobs.
			const start = Effect.fnUntraced(
				function* (input: Omit<RunRequest, 'worker'>) {
					yield* Effect.annotateCurrentSpan({job: input.name, scope: input.scope})
					if (platform === 'darwin') {
						return yield* DeployError.make({message: `${input.name} is not started by a timer`})
					}
					const timers = yield* Effect.flatMap(
						command('systemctl', [
							...Boolean.match(input.scope === 'system', {onFalse: () => ['--user'], onTrue: () => []}),
							'list-timers',
							'--all',
							'--output=json',
							'--no-pager'
						]),
						Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timer)))
					)
					if (!Array.some(timers, timer => Option.contains(timer.activates, input.name))) {
						return yield* DeployError.make({message: `${input.name} is not started by a timer`})
					}
					yield* Boolean.match(input.scope === 'system', {
						onFalse: () => command('systemctl', ['--user', 'start', '--no-block', input.name]),
						onTrue: () => command('sudo', ['-n', 'systemctl', 'start', '--no-block', input.name])
					})
				},
				Effect.scoped,
				Effect.mapError(cause => {
					if (Schema.is(DeployError)(cause)) return cause
					return DeployError.make({cause, message: 'Cannot start the job'})
				})
			)
			const collectSnapshot = Effect.withSpan(
				Effect.scoped(
					Effect.gen(function* () {
						const machine = yield* Boolean.match(platform === 'darwin', {onFalse: () => linux, onTrue: () => darwin})
						const sources = yield* Effect.all(
							[
								...machine.sources,
								collect(
									'Tailnet',
									pipe(
										command('tailscale', ['status', '--json']),
										Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Tailnet))),
										Effect.map(status =>
											Array.map(Option.toArray(status.Self), peer =>
												InventoryItem.make({
													detail: `${peer.OS} · ${Array.join(peer.TailscaleIPs, ', ')}`,
													hostname: Option.some(String.replace(/\.$/u, '')(peer.DNSName)),
													id: ItemId.make(`${worker}:peer:${peer.DNSName}`),
													kind: 'peer',
													name: peer.HostName,
													self: Option.some(true),
													state: Boolean.match(peer.Online, {
														onFalse: Function.constant('offline'),
														onTrue: Function.constant('online')
													}),
													url: Option.none(),
													worker
												})
											)
										)
									)
								),
								collect(
									'Tailscale Serve',
									pipe(
										command('tailscale', ['serve', 'status', '--json']),
										Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Serve))),
										Effect.map(status =>
											Array.flatMap(Record.toEntries(Option.getOrElse(status.Web, () => ({}))), site =>
												Array.map(Record.toEntries(site[1].Handlers), handler =>
													InventoryItem.make({
														detail: `${pipe(
															status.AllowFunnel,
															Option.exists(permissions => permissions[site[0]] === true),
															Boolean.match({
																onFalse: Function.constant('tailnet'),
																onTrue: Function.constant('Funnel permitted (public)')
															})
														)} → ${Option.getOrElse(handler[1].Proxy, Function.constant('non-proxy handler'))}`,
														health: pipe(
															status.AllowFunnel,
															Option.exists(permissions => permissions[site[0]] === true),
															Boolean.match({onFalse: () => 'quiet' as const, onTrue: () => 'warning' as const})
														),
														id: ItemId.make(`${worker}:tailscale:${site[0]}:${handler[0]}`),
														kind: 'exposure',
														name: ExposureName.make(`${site[0]}${handler[0]}`),
														owned: Option.some(false),
														port: pipe(
															handler[1].Proxy,
															Option.flatMap(String.match(/^http:\/\/(?:127\.0\.0\.1|localhost):([0-9]+)/u)),
															Option.flatMap(match => Number.parse(match[1] ?? ''))
														),
														publicAccess: Option.some(
															Option.exists(status.AllowFunnel, permissions => permissions[site[0]] === true)
														),
														state: 'observed',
														url: Option.some(`https://${site[0]}${handler[0]}`),
														worker
													})
												)
											)
										)
									)
								)
							],
							{concurrency: 'unbounded'}
						)
						const collected = yield* pipe(
							machine.processes,
							Effect.flatMap(current =>
								Ref.modify(processState, previous => {
									const next = processReadings(current, previous)
									return [next.readings, Option.some(next)]
								})
							),
							Effect.timeout(Duration.seconds(3)),
							Effect.match({
								onFailure: cause => ({error: Option.some(cause.message), records: []}),
								onSuccess: records => ({error: Option.none<string>(), records})
							})
						)
						return {
							items: attachProcesses(
								Array.flatMap(sources, source => source.items),
								collected.records
							),
							sources: [...Array.map(sources, source => source.source), {error: collected.error, name: 'Processes'}],
							time: yield* DateTime.now,
							workers: [worker]
						} satisfies Snapshot
					})
				),
				'Inventory.snapshot',
				{attributes: {worker}}
			)
			const snapshot = yield* SubscriptionRef.make(yield* collectSnapshot)
			const refresh = pipe(
				snapshot,
				SubscriptionRef.updateEffect(() => collectSnapshot),
				Effect.withSpan('Inventory.refresh')
			)
			yield* pipe(refresh, Effect.schedule(Schedule.spaced(Duration.seconds(5))), Effect.forkScoped)
			return {
				refresh,
				run: Effect.fn('Inventory.run')(function* (input) {
					yield* start(input)
					yield* refresh
				}),
				snapshot: SubscriptionRef.get(snapshot)
			}
		})
	)
}
