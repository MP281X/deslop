import {cpus, hostname} from 'node:os'
import {pid as collectorPid, platform} from 'node:process'

import {
	Array,
	Boolean,
	Clock,
	Context,
	Effect,
	FileSystem,
	HashMap,
	Layer,
	Number,
	Option,
	Record,
	Ref,
	Result,
	Schema,
	String,
	Tracer,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpTraceContext} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'

import {execute} from '@deslop/runtime/cli/command'

import {exitFailure, unitFailures} from '#services/inventory/lib/failures.ts'
import {launchAgents} from '#services/inventory/lib/launchd.ts'
import {attachProcesses, launchdProcesses, processReadings, processes} from '#services/inventory/lib/processes.ts'
import {
	type Socket,
	lsofSockets,
	probeSocket,
	socketLine,
	socketProcess,
	socketUnit
} from '#services/inventory/lib/sockets.ts'
import {
	Container,
	DeployError,
	InventoryItem,
	Serve,
	Snapshot,
	Tailnet,
	Timer,
	Unit
} from '#services/inventory/schema.ts'
import type {RunRequest} from '#services/inventory/schema.ts'

// Each listener with its unit, the app a Node listener's working directory names, and whether it answers HTTP; `unit` and `cwd` read a PID the platform's way.
function portItems(
	sockets: readonly Socket[],
	worker: string,
	http: HttpClient.HttpClient,
	origin: {
		readonly cwd: (pid: string) => Effect.Effect<Option.Option<string>>
		readonly unit: (pid: string) => Effect.Effect<string>
	}
) {
	return Effect.forEach(
		sockets,
		Effect.fnUntraced(function* (socket) {
			const unit = yield* Option.match(socket.process, {
				onNone: () => Effect.succeed(''),
				onSome: match => origin.unit(match.pid ?? '')
			})
			const process = yield* Option.match(socket.process, {
				onNone: () => Effect.succeed(''),
				onSome: Effect.fnUntraced(function* (match) {
					if (!String.startsWith('node')(match.name)) return match.name
					return Option.match(yield* origin.cwd(match.pid ?? ''), {
						onNone: () => match.name,
						onSome: cwd => socketProcess(match.name, cwd)
					})
				})
			})
			const response = yield* Boolean.match(probeSocket(socket, process), {
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
						Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
						Effect.timeout('700 millis'),
						Effect.option
					)
				})
			})
			return InventoryItem.make({
				...Option.getOrElse(response, () => ({http: false, ui: false})),
				address: socket.address,
				detail: `${socket.address} · ${process || 'process unavailable'}`,
				id: `${worker}:port:${socket.protocol}:${socket.address}`,
				kind: 'port',
				name: socket.address,
				port: socket.port,
				process,
				protocol: Boolean.match(socket.protocol === 'udp', {
					onFalse: () => 'tcp' as const,
					onTrue: () => 'udp' as const
				}),
				state: socket.state,
				unit,
				url: '',
				worker
			})
		}),
		{concurrency: 8}
	)
}

// What a worker's own collectors read: its sources, and its processes for the snapshot to attach by owner.
type Machine = {
	readonly processes: Effect.Effect<Effect.Success<typeof processes>, DeployError>
	readonly sources: readonly ReturnType<typeof collect<DeployError, never>>[]
}

function collect<E extends {readonly message: string}, R>(name: string, effect: Effect.Effect<InventoryItem[], E, R>) {
	return pipe(
		effect,
		Effect.timeout('10 seconds'),
		Effect.match({
			onFailure: cause => ({items: Array.empty<InventoryItem>(), source: {error: cause.message, name}}),
			onSuccess: items => ({items, source: {error: '', name}})
		})
	)
}

export class Inventory extends Context.Service<
	Inventory,
	{
		readonly run: (input: Omit<RunRequest, 'target'>) => Effect.Effect<void, DeployError>
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
					execute(name, args),
					Effect.mapError(cause => DeployError.make({cause, message: cause.message})),
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
				)
			}
			const worker = hostname()
			const processState = yield* Ref.make(Option.none<ReturnType<typeof processReadings>>())
			const units = Effect.fnUntraced(function* (system: boolean) {
				const scope = Boolean.match(system, {onFalse: () => 'user' as const, onTrue: () => 'system' as const})
				const manager = Boolean.match(system, {onFalse: () => ['--user'], onTrue: () => []})
				const scheduled = HashMap.fromIterable(
					Array.getSomes(
						Array.map(
							yield* pipe(
								command('systemctl', [...manager, 'list-timers', '--all', '--output=json', '--no-pager']),
								Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timer))))
							),
							timer =>
								Option.map(
									Option.fromNullishOr(timer.activates),
									unit => [unit, Option.map(Option.fromNullishOr(timer.next), next => Math.floor(next / 1000))] as const
								)
						)
					)
				)
				const rows = yield* pipe(
					command('systemctl', [...manager, 'list-units', '--all', '--type=service', '--output=json', '--no-pager']),
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Unit))))
				)
				const failed = Array.map(
					Array.filter(rows, row => row.active === 'failed'),
					row => row.unit
				)
				// Why each failed one stopped, in place of its description, which only repeats its command; an unreadable reason leaves the description.
				const failures = Option.getOrElse(
					Option.flatten(
						yield* pipe(
							command('systemctl', [
								...manager,
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
						detail: `${scope} · ${row.description}`,
						...Option.match(Option.fromUndefinedOr(failures[row.unit]), {
							onNone: () => ({}),
							onSome: failure => ({failure})
						}),
						id: `${worker}:${scope}:${row.unit}`,
						kind: 'service',
						name: row.unit,
						...Option.match(HashMap.get(scheduled, row.unit), {
							onNone: () => ({}),
							onSome: next =>
								Option.match(next, {onNone: () => ({scheduled: true}), onSome: time => ({next: time, scheduled: true})})
						}),
						scope,
						state: `${row.active} · ${row.sub}`,
						url: '',
						worker
					})
				)
			})
			const docker = pipe(
				command('docker', ['ps', '--all', '--format', '{{json .}}']),
				Effect.flatMap(text =>
					Effect.forEach(
						Array.filter(String.split(text, '\n'), String.isNonEmpty),
						line => Schema.decodeEffect(Schema.fromJsonString(Container))(line),
						{concurrency: 1}
					)
				),
				Effect.map(rows =>
					Array.map(rows, row =>
						InventoryItem.make({
							bindings: [
								...Array.map(
									Array.fromIterable(
										String.matchAll(/traefik\.http\.services\.[^=,]+\.loadbalancer\.server\.port=([0-9]+)/gu)(
											row.Labels ?? ''
										)
									),
									match => ({
										address: 'container',
										port: Option.getOrElse(Number.parse(match[1] ?? ''), () => 0),
										protocol: 'tcp' as const
									})
								),
								...Array.map(
									Array.fromIterable(String.matchAll(/((?:[0-9.]+|\[::\])):([0-9]+)->[0-9]+\/(tcp|udp)/gu)(row.Ports)),
									match => ({
										address: `${match[1]}:${match[2]}`,
										port: Option.getOrElse(Number.parse(match[2] ?? ''), () => 0),
										protocol: Boolean.match(match[3] === 'udp', {
											onFalse: () => 'tcp' as const,
											onTrue: () => 'udp' as const
										})
									})
								)
							],
							detail: row.Status,
							id: `${worker}:docker:${row.ID}`,
							kind: 'container',
							links: Array.dedupe(
								Array.map(
									Array.fromIterable(String.matchAll(/Host\(`([^`]+)`\)/gu)(row.Labels ?? '')),
									match => `https://${match[1]}`
								)
							),
							name: row.Names,
							state: row.State,
							url: '',
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
							portItems(Array.getSomes(Array.map(String.split(String.trim(text), '\n'), socketLine)), worker, http, {
								cwd: pid => Effect.option(fs.readLink(`/proc/${pid}/cwd`)),
								unit: pid =>
									Effect.map(Effect.option(fs.readFileString(`/proc/${pid}/cgroup`)), cgroup =>
										socketUnit(Option.getOrElse(cgroup, () => ''))
									)
							})
						)
					)
				]
			})
			// A Mac's Deslop launch agents and listeners, and the processes under each agent, measured together so CPU shares compare like readings.
			const darwin: Effect.Effect<Machine> = Effect.gen(function* () {
				const launchd = yield* Effect.all(
					{
						agents: Effect.result(Effect.map(command('launchctl', ['list']), launchAgents)),
						table: Effect.result(
							command('env', ['LC_ALL=C', 'ps', '-axww', '-o', 'pid=,ppid=,rss=,time=,lstart=,args='])
						)
					},
					{concurrency: 'unbounded'}
				)
				const time = yield* Clock.currentTimeMillis
				const total = Number.sumAll(Array.flatMap(cpus(), cpu => Record.values(cpu.times)))
				const records = Result.map(launchd.table, text =>
					Array.filter(
						launchdProcesses(
							text,
							Record.fromEntries(
								Array.getSomes(
									Array.map(
										Result.getOrElse(launchd.agents, () => []),
										agent => Option.map(agent.pid, pid => [`${pid}`, agent.label] as const)
									)
								)
							)
						),
						record => record.process.parent !== collectorPid
					)
				)
				const owned = Result.getOrElse(records, () => [])
				return {
					processes: Effect.map(Effect.fromResult(records), found => ({records: found, time, total})),
					sources: [
						collect(
							'Launch agents',
							Effect.map(Effect.fromResult(launchd.agents), agents =>
								Array.map(agents, agent =>
									InventoryItem.make({
										detail: 'user · launch agent',
										...Boolean.match(Option.isNone(agent.pid) && agent.status !== 0, {
											onFalse: () => ({}),
											onTrue: () => ({failure: {reason: exitFailure(agent.status)}})
										}),
										id: `${worker}:user:${agent.label}`,
										kind: 'service',
										name: agent.label,
										scope: 'user',
										state: Option.match(agent.pid, {
											onNone: () =>
												Boolean.match(agent.status === 0, {
													onFalse: () => 'failed · failed',
													onTrue: () => 'inactive · dead'
												}),
											onSome: () => 'active · running'
										}),
										url: '',
										worker
									})
								)
							)
						),
						collect(
							'Listening ports',
							Effect.flatMap(command('lsof', ['-nP', '+c0', '-iTCP', '-sTCP:LISTEN', '-iUDP', '-F', 'pctPnT']), text =>
								portItems(lsofSockets(text), worker, http, {
									cwd: Effect.fnUntraced(function* (pid) {
										const lines = String.split(
											Option.getOrElse(
												yield* Effect.option(command('lsof', ['-nP', '-a', '-p', pid, '-d', 'cwd', '-Fn'])),
												() => ''
											),
											'\n'
										)
										return Option.map(Array.findFirst(lines, String.startsWith('n')), String.slice(1))
									}),
									unit: pid =>
										Effect.succeed(
											Option.getOrElse(
												Option.map(
													Array.findFirst(owned, record => `${record.process.pid}` === pid),
													record => record.unit
												),
												() => ''
											)
										)
								})
							)
						)
					]
				}
			})
			return Inventory.of({
				// Only a service a timer starts, so the page can't start arbitrary units; system ones go through the workers' passwordless sudo. A Mac's launch agents are apps, never timer jobs.
				run: Effect.fnUntraced(
					function* (input) {
						if (platform === 'darwin') {
							return yield* DeployError.make({message: `${input.name} is not started by a timer`})
						}
						const timers = yield* pipe(
							command('systemctl', [
								...Boolean.match(input.scope === 'system', {onFalse: () => ['--user'], onTrue: () => []}),
								'list-timers',
								'--all',
								'--output=json',
								'--no-pager'
							]),
							Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Timer))))
						)
						if (!Array.some(timers, timer => timer.activates === input.name)) {
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
				),
				snapshot: Effect.scoped(
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
											Array.map(
												[...Option.toArray(Option.fromUndefinedOr(status.Self)), ...Record.values(status.Peer ?? {})],
												peer =>
													InventoryItem.make({
														detail: `${peer.OS} · ${Array.join(peer.TailscaleIPs, ', ')}`,
														hostname: String.replace(/\.$/u, '')(peer.DNSName),
														id: `${worker}:peer:${peer.DNSName}`,
														kind: 'peer',
														name: peer.HostName,
														self: peer.DNSName === status.Self?.DNSName,
														state: Boolean.match(peer.Online, {onFalse: () => 'offline', onTrue: () => 'online'}),
														url: '',
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
											Array.flatMap(Record.toEntries(status.Web ?? {}), site =>
												Array.map(Record.toEntries(site[1].Handlers), handler =>
													InventoryItem.make({
														detail: `${Boolean.match(status.AllowFunnel?.[site[0]] === true, {onFalse: () => 'tailnet', onTrue: () => 'Funnel permitted (public)'})} → ${handler[1].Proxy ?? 'non-proxy handler'}`,
														id: `${worker}:tailscale:${site[0]}:${handler[0]}`,
														kind: 'exposure',
														name: `${site[0]}${handler[0]}`,
														owned: false,
														publicAccess: status.AllowFunnel?.[site[0]] === true,
														...Option.match(
															Option.flatMap(
																String.match(/^http:\/\/(?:127\.0\.0\.1|localhost):([0-9]+)/u)(handler[1].Proxy ?? ''),
																match => Number.parse(match[1] ?? '')
															),
															{onNone: () => ({}), onSome: port => ({port})}
														),
														state: 'observed',
														url: `https://${site[0]}${handler[0]}`,
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
									const next = processReadings(current, Option.getOrUndefined(previous))
									return [next.readings, Option.some(next)]
								})
							),
							Effect.timeout('3 seconds'),
							Effect.match({
								onFailure: cause => ({error: cause.message, records: []}),
								onSuccess: records => ({error: '', records})
							})
						)
						return Snapshot.make({
							items: attachProcesses(
								Array.flatMap(sources, source => source.items),
								collected.records
							),
							sources: [...Array.map(sources, source => source.source), {error: collected.error, name: 'Processes'}],
							time: yield* Clock.currentTimeMillis,
							workers: [worker]
						})
					})
				)
			})
		})
	)
}
