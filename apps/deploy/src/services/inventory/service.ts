import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	Layer,
	Number,
	Option,
	Record,
	Schema,
	Stream,
	String,
	pipe
} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {Container, DeployError, InventoryItem, Serve, Snapshot, Tailnet, Unit} from '#services/inventory/schema.ts'

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

function portItems(text: string, worker: string, fs: FileSystem.FileSystem) {
	return Effect.forEach(
		Array.filter(String.split(String.trim(text), '\n'), String.isNonEmpty),
		Effect.fnUntraced(function* (line) {
			const fields = String.split(String.trim(line), /\s+/u)
			const address = fields[4] ?? ''
			const port = Option.getOrElse(
				Number.parse(Option.getOrElse(Array.last(String.split(address, ':')), () => '')),
				() => 0
			)
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
			return InventoryItem.make({
				address,
				detail: `${address} · ${process || 'process unavailable'}`,
				id: `${worker}:port:${fields[0]}:${address}`,
				kind: 'port',
				name: address,
				port,
				process,
				protocol: Boolean.match(fields[0] === 'udp', {onFalse: () => 'tcp' as const, onTrue: () => 'udp' as const}),
				state: fields[1] ?? 'listening',
				url: '',
				worker
			})
		}),
		{concurrency: 'unbounded'}
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

export class Inventory extends Context.Service<Inventory, {readonly snapshot: Effect.Effect<Snapshot>}>()(
	'@deslop/deploy/services/inventory/service/Inventory'
) {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const fs = yield* FileSystem.FileSystem
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			function command(name: string, args: string[]) {
				return Effect.provideService(execute(name, args), ChildProcessSpawner.ChildProcessSpawner, spawner)
			}
			const worker = yield* pipe(Config.String('HOSTNAME'), Config.withDefault('local'))
			function units(system: boolean) {
				const scope = Boolean.match(system, {onFalse: () => 'user' as const, onTrue: () => 'system' as const})
				return pipe(
					command('systemctl', [
						...Boolean.match(system, {onFalse: () => ['--user'], onTrue: () => []}),
						'list-units',
						'--all',
						'--type=service',
						'--output=json',
						'--no-pager'
					]),
					Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Schema.Array(Unit)))),
					Effect.map(rows =>
						Array.map(rows, row =>
							InventoryItem.make({
								detail: `${scope} · ${row.description}`,
								id: `${worker}:${scope}:${row.unit}`,
								kind: 'service',
								name: row.unit,
								scope,
								state: `${row.active} · ${row.sub}`,
								url: '',
								worker
							})
						)
					)
				)
			}
			return Inventory.of({
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
													detail: Array.join(
														Array.filter(
															[
																String.replace(
																	/:([a-f0-9]{8})[a-f0-9]{16,}$/u,
																	':$1'
																)(String.replace(/^.*\//u, '')(row.Image)),
																row.Status,
																row.Ports
															],
															String.isNonEmpty
														),
														' · '
													),
													id: `${worker}:docker:${row.ID}`,
													kind: 'container',
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
									Effect.flatMap(command('ss', ['-H', '-lntup']), text => portItems(text, worker, fs))
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
						return Snapshot.make({
							items: Array.flatMap(sources, source => source.items),
							sources: Array.map(sources, source => source.source),
							time: yield* Clock.currentTimeMillis
						})
					})
				)
			})
		})
	)
}
