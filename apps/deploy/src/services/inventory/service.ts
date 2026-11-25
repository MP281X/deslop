import {
	Array,
	Boolean,
	Cache,
	DateTime,
	Duration,
	Context,
	Effect,
	Equal,
	Exit,
	Fiber,
	FileSystem,
	Function,
	HashMap,
	Layer,
	Number,
	Option,
	Record,
	Ref,
	Schema,
	String,
	SubscriptionRef,
	Tracer,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpTraceContext} from 'effect/http'
import {ChildProcessSpawner} from 'effect/process'
import {Reactivity} from 'effect/reactivity'

import {executeProcess} from '@deslop/runtime/server/process'
import type {Admin} from '@deslop/runtime/shared/auth'

import {unitFailures} from './lib/failures.ts'
import {attachProcesses, processReadings, processes} from './lib/processes.ts'
import {type Socket, probeSocket, socketLine, socketProcess, socketUnit} from './lib/sockets.ts'

import {
	Container,
	DeployError,
	ExposureName,
	InventoryItem,
	ItemId,
	Serve,
	TailnetStatus,
	Timer,
	Unit
} from '#services/inventory/schema.ts'
import type {ProcessId, RunRequest, ServiceScope, Snapshot, UnitId} from '#services/inventory/schema.ts'

declare module 'effect/reactivity/Reactivity' {
	interface Keys {
		readonly deployInventory: never
	}
}

// Each listener with its unit, the app a Node listener's working directory names, and whether it answers HTTP. A PID whose start time changed while it was read was reused, so its listener keeps none of what was read.
function portItems(
	sockets: readonly Socket[],
	probe: (port: number, identity: string) => Effect.Effect<Option.Option<{http: boolean; ui: boolean}>>,
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
						Option.match({onNone: () => match.name, onSome: cwd => socketProcess(match.name, cwd)}),
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

// One JSON container per line of `docker ps --format '{{json .}}'`.
function containerRows(listing: string) {
	return pipe(
		listing,
		String.split('\n'),
		Array.filter(String.isNonEmpty),
		Array.map(line => Schema.decodeOption(Schema.fromJsonString(Container))(line)),
		Array.getSomes
	)
}

export class Inventory extends Context.Service<
	Inventory,
	{
		readonly refresh: Effect.Effect<void>
		readonly ensureFresh: Effect.Effect<void>
		readonly run: (input: RunRequest, admin: Admin) => Effect.Effect<void, DeployError>
		readonly snapshot: Effect.Effect<Snapshot>
	}
>()('@deslop/deploy/services/inventory/service/Inventory') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const http = yield* HttpClient.HttpClient
			const reactivity = yield* Reactivity.Reactivity
			const layerScope = yield* Effect.scope
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			// A command that hangs is killed within its source's ten seconds; optional metadata names a shorter wait so a stall drops only itself.
			function command(name: string, args: string[], timeout: Duration.Input = '10 seconds') {
				return pipe(
					executeProcess(name, args, {timeout}),
					Effect.mapError(cause =>
						DeployError.make({cause, message: `Could not run ${name}; inspect Deploy's process logs.`})
					),
					Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, spawner)
				)
			}
			// A JSON listing whose malformed rows are skipped, while an unreadable listing fails.
			function systemctlRows<A>(args: string[], row: Schema.Decoder<A>) {
				return pipe(
					command('systemctl', args),
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Schema.Unknown)))),
					Effect.map(rows => Array.getSomes(Array.map(rows, item => Schema.decodeUnknownOption(row)(item))))
				)
			}
			const processState = yield* Ref.make(Option.none<ReturnType<typeof processReadings>>())
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
							value.status >= 200 &&
							value.status < 400 &&
							String.includes('text/html')(value.headers['content-type'] ?? '')
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
			function probe(port: number, identity: string) {
				// Without a readable start time a reused PID cannot be distinguished, so do not cache it.
				if (identity === '') return head(port)
				return Cache.get(probes, [port, identity])
			}
			const units = Effect.fnUntraced(function* (system: boolean) {
				const scope = Boolean.match(system, {
					onFalse: Function.constant('user' as const),
					onTrue: Function.constant('system' as const)
				})
				const scopeFlags = Boolean.match(system, {onFalse: () => ['--user'], onTrue: () => []})
				// Each systemctl call costs a few hundred milliseconds, so the timers and units are read side by side.
				const listed = yield* Effect.all(
					{
						rows: systemctlRows(
							[...scopeFlags, 'list-units', '--all', '--type=service', '--output=json', '--no-pager'],
							Unit
						),
						timers: systemctlRows([...scopeFlags, 'list-timers', '--all', '--output=json', '--no-pager'], Timer)
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
			const docker = pipe(
				command('docker', ['ps', '--all', '--format', '{{json .}}']),
				Effect.map(containerRows),
				Effect.map(rows =>
					Array.map(rows, row =>
						InventoryItem.make({
							active: Array.contains(['running', 'restarting', 'paused'], row.State),
							bindings: Option.some(
								Array.filter(
									[
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
											Array.fromIterable(
												String.matchAll(/((?:[0-9.]+|\[[0-9a-f:]+\])):([0-9]+)->[0-9]+\/(tcp|udp)/giu)(row.Ports)
											),
											match => ({
												address: `${match[1]}:${match[2]}`,
												port: Option.getOrElse(Number.parse(match[2] ?? ''), Function.constant(0)),
												protocol: Boolean.match(match[3] === 'udp', {
													onFalse: Function.constant('tcp' as const),
													onTrue: Function.constant('udp' as const)
												})
											})
										)
									],
									binding => binding.port > 0 && binding.port <= 65_535
								)
							),
							detail: row.Status,
							health: Boolean.match(
								String.includes('unhealthy')(row.Status) || Option.isSome(String.match(/Exited \([1-9]/u)(row.Status)),
								{
									onFalse: () =>
										Boolean.match(row.State === 'restarting', {
											onFalse: Function.constant('quiet' as const),
											onTrue: Function.constant('warning' as const)
										}),
									onTrue: Function.constant('error' as const)
								}
							),
							id: ItemId.make(`docker:${row.ID}`),
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
							url: Option.none()
						})
					)
				)
			)
			// This machine's processes from /proc, each owned by its cgroup, and its systemd units, containers and listeners.
			const processTable = pipe(
				processes,
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.mapError(cause => DeployError.make({cause, message: 'The processes could not be read.'}))
			)
			const machineSources = [
				collect('User services', units(false)),
				collect('System services', units(true)),
				collect('Docker', docker),
				collect(
					'Listening ports',
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
			]
			// Only a service a timer starts, so the page can't start arbitrary units; system ones go through the machine's passwordless sudo.
			const start = Effect.fnUntraced(
				function* (input: RunRequest) {
					yield* Effect.annotateCurrentSpan({job: input.name, scope: input.scope})
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
						// The process table is read while the sources' commands run, not after them.
						const processing = yield* pipe(
							processTable,
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
							}),
							Effect.forkScoped
						)
						const sources = yield* Effect.all(
							[
								...machineSources,
								collect(
									'Tailnet',
									pipe(
										command('tailscale', ['status', '--json']),
										Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(TailnetStatus))),
										Effect.map(status =>
											Array.map(Option.toArray(status.Self), peer =>
												InventoryItem.make({
													detail: `${peer.OS} · ${Array.join(peer.TailscaleIPs, ', ')}`,
													hostname: Option.some(String.replace(/\.$/u, '')(peer.DNSName)),
													id: ItemId.make(`peer:${peer.DNSName}`),
													kind: 'peer',
													name: peer.HostName,
													self: Option.some(true),
													state: Boolean.match(peer.Online, {
														onFalse: Function.constant('offline'),
														onTrue: Function.constant('online')
													}),
													url: Option.none()
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
															Boolean.match({
																onFalse: Function.constant('quiet' as const),
																onTrue: Function.constant('warning' as const)
															})
														),
														id: ItemId.make(`tailscale:${site[0]}:${handler[0]}`),
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
														// A root handler's address is the site's own, as an owned exposure writes it, so a row shows the two as one.
														url: Option.some(`https://${site[0]}${String.replace(/^\/$/u, '')(handler[0])}`)
													})
												)
											)
										)
									)
								)
							],
							{concurrency: 'unbounded'}
						)
						const collected = yield* Fiber.join(processing)
						return {
							items: attachProcesses(
								Array.flatMap(sources, source => source.items),
								collected.records
							),
							sources: [...Array.map(sources, source => source.source), {error: collected.error, name: 'Processes'}],
							time: yield* DateTime.now
						} satisfies Snapshot
					})
				),
				'Inventory.snapshot'
			)
			const snapshot = yield* SubscriptionRef.make(yield* collectSnapshot)
			const [ensureFresh, invalidate] = yield* Effect.cachedInvalidateWithTTL(
				pipe(
					snapshot,
					SubscriptionRef.updateEffect(() => collectSnapshot),
					Effect.withSpan('Inventory.refresh')
				),
				Duration.seconds(5)
			)
			const refresh = Effect.andThen(invalidate, ensureFresh)
			return {
				ensureFresh,
				refresh,
				// The caller gets the start's answer at once; the refresh that follows wakes viewers when it lands, so a deadline never waits on it.
				run: Effect.fn('Inventory.run')(function* (input) {
					yield* Effect.onExit(start(input), () =>
						pipe(refresh, Effect.andThen(reactivity.invalidate(['deployInventory'])), Effect.forkIn(layerScope))
					)
				}),
				snapshot: SubscriptionRef.get(snapshot)
			}
		})
	)
}
