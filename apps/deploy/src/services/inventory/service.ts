import {Array, Boolean, Clock, Config, Context, Effect, Layer, Record, Schema, Stream, String, pipe} from 'effect'

import {ChildProcess, ChildProcessSpawner} from 'effect/process'

import {Container, DeployError, Item, Snapshot, Tailnet, Unit} from '#services/inventory/schema.ts'

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

function portItems(text: string, worker: string) {
	return Array.map(Array.filter(String.split(String.trim(text), '\n'), String.isNonEmpty), line => {
		const fields = String.split(String.trim(line), /\s+/u)
		return Item.make({
			detail: line,
			id: `${worker}:port:${line}`,
			kind: 'port',
			name: fields[4] ?? '',
			state: fields[1] ?? 'listening',
			url: '',
			worker
		})
	})
}

function collect<E, R>(name: string, effect: Effect.Effect<Item[], E, R>) {
	return pipe(
		effect,
		Effect.timeout('10 seconds'),
		Effect.match({
			onFailure: cause => ({items: Array.empty<Item>(), source: {error: `${cause}`, name}}),
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
			const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
			function command(name: string, args: string[]) {
				return Effect.provideService(execute(name, args), ChildProcessSpawner.ChildProcessSpawner, spawner)
			}
			const worker = yield* pipe(Config.String('HOSTNAME'), Config.withDefault('local'))
			function units(system: boolean) {
				const scope = Boolean.match(system, {onFalse: () => 'user', onTrue: () => 'system'})
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
							Item.make({
								detail: `${scope} · ${row.description}`,
								id: `${worker}:${scope}:${row.unit}`,
								kind: 'service',
								name: row.unit,
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
												Item.make({
													detail: `${row.Image} · ${row.Status} · ${row.Ports}`,
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
									Effect.map(command('ss', ['-H', '-lntup']), text => portItems(text, worker))
								),
								collect(
									'Tailnet',
									pipe(
										command('tailscale', ['status', '--json']),
										Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Tailnet))),
										Effect.map(status =>
											Array.map(Record.values(status.Peer ?? {}), peer =>
												Item.make({
													detail: `${peer.OS} · ${Array.join(peer.TailscaleIPs, ', ')}`,
													id: `${worker}:peer:${peer.DNSName}`,
													kind: 'peer',
													name: peer.HostName,
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
										Effect.map(text => [
											Item.make({
												detail: text,
												id: `${worker}:tailscale`,
												kind: 'exposure',
												name: 'Tailscale Serve',
												state: 'observed',
												url: '',
												worker
											})
										])
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
