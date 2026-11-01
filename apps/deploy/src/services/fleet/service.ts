import {NodeSocket} from '@effect/platform-node'

import {
	Array,
	Boolean,
	Clock,
	Config,
	Context,
	Effect,
	FileSystem,
	Layer,
	Path,
	Record,
	Ref,
	Schema,
	Struct,
	pipe
} from 'effect'

import {HttpClient} from 'effect/http'
import type {Headers} from 'effect/http'
import {RpcClient, RpcSerialization} from 'effect/rpc'

import {oauth} from '@deslop/runtime/oauth'

import {RpcContracts} from '#rpcs/contracts.ts'
import {Exposures} from '#services/exposures/service.ts'
import {DeployError, Snapshot, Worker} from '#services/inventory/schema.ts'
import type {ExposeRequest, HideRequest} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'

const makeRemoteClient = RpcClient.make(RpcContracts, {flatten: true})
type RemoteClient = Effect.Success<typeof makeRemoteClient>

function changeFailed<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Worker exposure change failed'})
	})
}

export class Fleet extends Context.Service<
	Fleet,
	{
		readonly expose: (input: ExposeRequest) => Effect.Effect<string, DeployError>
		readonly hide: (input: HideRequest) => Effect.Effect<void, DeployError>
		readonly local: Effect.Effect<Snapshot>
		readonly snapshot: Effect.Effect<Snapshot>
	}
>()('@deslop/deploy/services/fleet/service/Fleet') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const inventory = yield* Inventory
			const exposures = yield* Exposures
			const fs = yield* FileSystem.FileSystem
			const path = yield* Path.Path
			const http = yield* HttpClient.HttpClient
			const workers = yield* pipe(
				Config.String('DEPLOY_WORKERS'),
				Config.withDefault('[]'),
				Effect.flatMap(Schema.decodeEffect(Schema.fromJsonString(Schema.Array(Worker))))
			)
			const previous = yield* Ref.make<Record<string, Snapshot>>({})
			const local = Effect.gen(function* () {
				const snapshot = yield* inventory.snapshot
				return Snapshot.make({...snapshot, items: [...snapshot.items, ...(yield* exposures.items)]})
			})
			const remote = Effect.fnUntraced(
				function* <A, E>(worker: Worker, use: (client: RemoteClient, headers: Headers.Input) => Effect.Effect<A, E>) {
					const url = yield* Effect.try({
						catch: cause => DeployError.make({cause, message: 'Invalid worker URL'}),
						try: () => new URL('/api/rpc', worker.url)
					})
					if (url.protocol !== 'https:' && !Array.contains(['127.0.0.1', 'localhost', '[::1]'], url.hostname)) {
						return yield* DeployError.make({message: 'Remote workers require HTTPS'})
					}
					url.protocol = 'wss:'
					if (new URL(worker.url).protocol === 'http:') url.protocol = 'ws:'
					const headers = yield* Boolean.match(worker.auth === '', {
						onFalse: () =>
							pipe(
								oauth('deploy', new URL(worker.url).origin, worker.auth),
								Effect.flatMap(session => session.token),
								Effect.map(token => ({authorization: `Bearer ${token}`}))
							),
						onTrue: () => Effect.succeed({})
					})
					return yield* pipe(
						Effect.flatMap(makeRemoteClient, client => use(client, headers)),
						// @effect-diagnostics-next-line strictEffectProvide:off -- Each remote poll owns its RPC socket and closes it on success, error or timeout.
						Effect.provide(
							pipe(
								RpcClient.layerProtocolSocket({pingTimeout: '15 seconds'}),
								Layer.provide(NodeSocket.layerWebSocket(url.href)),
								Layer.provide(RpcSerialization.layerSchemaBinary())
							)
						)
					)
				},
				Effect.scoped,
				Effect.timeout('15 seconds'),
				Effect.provideService(FileSystem.FileSystem, fs),
				Effect.provideService(Path.Path, path),
				Effect.provideService(HttpClient.HttpClient, http)
			)
			function selectedWorker(target: string) {
				return pipe(
					Effect.fromOption(Array.findFirst(workers, worker => worker.name === target)),
					Effect.mapError(cause =>
						DeployError.make({cause, message: 'This worker is not configured on the control plane'})
					)
				)
			}
			return Fleet.of({
				expose: Effect.fnUntraced(function* (input) {
					if (input.target === undefined || input.target === '') {
						return yield* exposures.expose(Struct.omit(input, ['target']))
					}
					return yield* remote(yield* selectedWorker(input.target), (client, headers) =>
						client('deploy.expose', Struct.omit(input, ['target']), {headers})
					)
				}, changeFailed),
				hide: Effect.fnUntraced(function* (input) {
					if (input.target === undefined || input.target === '') return yield* exposures.hide(input.name)
					return yield* remote(yield* selectedWorker(input.target), (client, headers) =>
						client('deploy.hide', {name: input.name}, {headers})
					)
				}, changeFailed),
				local,
				snapshot: Effect.gen(function* () {
					const own = yield* local
					const others = yield* Effect.forEach(
						workers,
						worker =>
							pipe(
								remote(worker, (client, headers) => client('deploy.snapshot', undefined, {headers})),
								Effect.map(snapshot =>
									Snapshot.make({
										...snapshot,
										items: Array.map(snapshot.items, item => ({
											...item,
											id: `remote:${worker.name}:${item.id}`,
											worker: worker.name
										})),
										sources: Array.map(snapshot.sources, source => ({
											...source,
											name: `${worker.name} · ${source.name}`
										}))
									})
								),
								Effect.tap(snapshot => Ref.update(previous, rows => Record.set(rows, worker.name, snapshot))),
								Effect.matchEffect({
									onFailure: cause =>
										Effect.map(Ref.get(previous), rows =>
											Snapshot.make({
												items: Array.map(rows[worker.name]?.items ?? [], item => ({
													...item,
													detail: `${item.detail}\nLast successful sample: ${rows[worker.name]?.time}`,
													state: `stale · ${item.state}`
												})),
												sources: [{error: `${cause}`, name: worker.name}],
												time: 0
											})
										),
									onSuccess: Effect.succeed
								})
							),
						{concurrency: 'unbounded'}
					)
					return Snapshot.make({
						items: [...own.items, ...Array.flatMap(others, value => value.items)],
						sources: [...own.sources, ...Array.flatMap(others, value => value.sources)],
						time: yield* Clock.currentTimeMillis
					})
				})
			})
		})
	)
}
