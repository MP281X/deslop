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
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {FetchHttpClient, HttpClient, HttpTraceContext} from 'effect/http'
import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {attachProcesses, processReadings, processes} from '#services/inventory/lib/processes.ts'
import {unitFailures} from '#services/inventory/lib/utils.ts'
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

const execute = Effect.fnUntraced(function* (name: string, args: string[]) {
	const handle = yield* ChildProcess.make(name, args, {stderr: 'pipe', stdout: 'pipe'})
	const output = yield* Effect.all(
		{
			code: handle.exitCode,
			error: Stream.mkString(Stream.decodeText(handle.stderr)),
			text: Stream.mkString(Stream.decodeText(handle.stdout))
		},
		{concurrency: 'unbounded'}
	)
	if (output.code !== 0) return yield* DeployError.make({message: `${name}: ${output.error}`})
	return output.text
})

function portItems(text: string, worker: string, fs: FileSystem.FileSystem, http: HttpClient.HttpClient) {
	return Effect.forEach(
		Array.filter(String.split(String.trim(text), '\n'), String.isNonEmpty),
		Effect.fnUntraced(function* (line) {
			const fields = String.split(String.trim(line), /\s+/u)
			const address = fields[4] ?? ''
			const port = Option.getOrElse(
				Number.parse(Option.getOrElse(Array.last(String.split(address, ':')), () => '')),
				() => 0
			)
			const cgroup = yield* Option.match(String.match(/pid=([0-9]+)/u)(line), {
				onNone: () => Effect.succeed(''),
				onSome: Effect.fnUntraced(function* (match) {
					return Option.getOrElse(yield* Effect.option(fs.readFileString(`/proc/${match[1]}/cgroup`)), () => '')
				})
			})
			const unit =
				Option.getOrElse(
					Array.last(Array.fromIterable(String.matchAll(/\/([^/]+\.service)(?=\/|\n|$)/gu)(cgroup))),
					() => ['', '']
				)[1] ?? ''
			const process = yield* Option.match(String.match(/users:\(\("([^"]+)",pid=([0-9]+)/u)(line), {
				onNone: () => Effect.succeed(''),
				onSome: Effect.fnUntraced(function* (match) {
					if (!String.startsWith('node')(match[1] ?? '')) return match[1] ?? ''
					return yield* pipe(
						fs.readLink(`/proc/${match[2]}/cwd`),
						Effect.map(cwd =>
							Option.match(String.match(/\/apps\/([^/]+)(?:\/|$)/u)(cwd), {
								onNone: () => match[1] ?? '',
								onSome: app => app[1] ?? ''
							})
						),
						Effect.orElseSucceed(() => match[1] ?? '')
					)
				})
			})
			const response = yield* Boolean.match(
				fields[0] === 'tcp' &&
					port >= 1024 &&
					Option.isSome(String.match(/^(?:127\.0\.0\.1|0\.0\.0\.0):/u)(address)) &&
					Option.isNone(String.match(/^(?:postgres|redis|ssh|cloudflared|tailscaled|caddy)$/u)(process)),
				{
					onFalse: () => Effect.succeed(Option.none<{http: boolean; ui: boolean}>()),
					onTrue: Effect.fnUntraced(function* () {
						// The probed app still traces its side under this inventory, so its HEAD spans stay out of its own operations.
						return yield* pipe(
							Effect.option(Effect.currentSpan),
							Effect.flatMap(parent =>
								http.head(`http://127.0.0.1:${port}/`, {
									headers: Option.match(parent, {onNone: () => ({}), onSome: HttpTraceContext.toHeaders})
								})
							),
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
				}
			)
			return InventoryItem.make({
				...Option.getOrElse(response, () => ({http: false, ui: false})),
				address,
				detail: `${address} · ${process || 'process unavailable'}`,
				id: `${worker}:port:${fields[0]}:${address}`,
				kind: 'port',
				name: address,
				port,
				process,
				protocol: Boolean.match(fields[0] === 'udp', {onFalse: () => 'tcp' as const, onTrue: () => 'udp' as const}),
				state: fields[1] ?? 'listening',
				unit,
				url: '',
				worker
			})
		}),
		{concurrency: 8}
	)
}

function collect<E, R>(name: string, effect: Effect.Effect<InventoryItem[], E, R>) {
	return pipe(
		effect,
		Effect.timeout('10 seconds'),
		Effect.match({
			onFailure: cause => ({items: Array.empty<InventoryItem>(), source: {error: `${cause}`, name}}),
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
				return Effect.provideService(execute(name, args), ChildProcessSpawner.ChildProcessSpawner, spawner)
			}
			const worker = String.trim(yield* fs.readFileString('/proc/sys/kernel/hostname'))
			const processState = yield* Ref.make(Option.none<ReturnType<typeof processReadings>>())
			const units = Effect.fnUntraced(function* (system: boolean) {
				const scope = Boolean.match(system, {onFalse: () => 'user' as const, onTrue: () => 'system' as const})
				const manager = Boolean.match(system, {onFalse: () => ['--user'], onTrue: () => []})
				// Each timer-started service, with its next start when one is due.
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
								'Id,Result,ExecMainStatus,StateChangeTimestamp',
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
			return Inventory.of({
				// Only a service a timer starts, so the page can't start arbitrary units; system ones go through the workers' passwordless sudo.
				run: Effect.fnUntraced(
					function* (input) {
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
						const sources = yield* Effect.all(
							[
								collect('User services', units(false)),
								collect('System services', units(true)),
								collect(
									'Docker',
									pipe(
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
																String.matchAll(
																	/traefik\.http\.services\.[^=,]+\.loadbalancer\.server\.port=([0-9]+)/gu
																)(row.Labels ?? '')
															),
															match => ({
																address: 'container',
																port: Option.getOrElse(Number.parse(match[1] ?? ''), () => 0),
																protocol: 'tcp' as const
															})
														),
														...Array.map(
															Array.fromIterable(
																String.matchAll(/((?:[0-9.]+|\[::\])):([0-9]+)->[0-9]+\/(tcp|udp)/gu)(row.Ports)
															),
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
								),
								collect(
									'Listening ports',
									Effect.flatMap(command('ss', ['-H', '-lntup']), text => portItems(text, worker, fs, http))
								),
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
							processes,
							Effect.provideService(FileSystem.FileSystem, fs),
							Effect.flatMap(current =>
								Ref.modify(processState, previous => {
									const next = processReadings(current, Option.getOrUndefined(previous))
									return [next.readings, Option.some(next)]
								})
							),
							Effect.timeout('3 seconds'),
							Effect.match({
								onFailure: cause => ({error: `${cause}`, records: []}),
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
