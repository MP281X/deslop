import {hostname} from 'node:os'

import {NodeSocket} from '@effect/platform-node'

import {
	Array,
	DateTime,
	Duration,
	Config,
	Context,
	Effect,
	HashMap,
	Layer,
	Option,
	Record,
	Redacted,
	Ref,
	Schema,
	String,
	Struct,
	pipe
} from 'effect'

import {Digest} from 'effect/crypto'
import type {Headers} from 'effect/http'
import {RpcClient, RpcSerialization} from 'effect/rpc'

import {Auth} from '@deslop/runtime/server/auth'
import type {User} from '@deslop/runtime/shared/auth'
import {UserId} from '@deslop/runtime/shared/auth'
import {RpcStream, layerRpcStreamClient} from '@deslop/runtime/shared/rpc'
import {RPC_PATH} from '@deslop/runtime/shared/schema'

import {RpcContracts} from '#rpcs/contracts.ts'
import type {ExposeRequest, HideRequest} from '#services/exposures/schema.ts'
import {Exposures} from '#services/exposures/service.ts'
import {DeployError, ItemId, Snapshot, Worker} from '#services/inventory/schema.ts'
import type {RunRequest, WorkerId} from '#services/inventory/schema.ts'
import {Inventory} from '#services/inventory/service.ts'
import {history} from '#services/metrics/lib/utils.ts'
import type {HistoryQuery, MachineHistory} from '#services/metrics/schema.ts'
import {Metrics} from '#services/metrics/service.ts'

// Who another worker's Deploy acts as: its bearer is the shared key, never a person's sign-in.
const PEER = {id: UserId.make('deploy:peer'), name: 'deploy'} satisfies User

const makeRemoteClient = RpcClient.make(RpcContracts.middleware(RpcStream), {flatten: true})

// Workers authorize each other with the DEPLOY_KEY their env files share, compared by digest; people sign in as on every app.
export const layerPeerAuth = Layer.effectContext(
	Effect.gen(function* () {
		const auth = yield* Auth
		const digest = yield* Digest.Digest
		function hash(text: string) {
			return digest.digestHex(Digest.sha256, new TextEncoder().encode(text))
		}
		const expected = yield* Effect.transposeOption(
			Option.map(yield* Config.option(Config.Redacted('DEPLOY_KEY')), key => hash(`Bearer ${Redacted.value(key)}`))
		)
		return Auth.makeContext(
			Auth.of({
				token: auth.token,
				user: Effect.fnUntraced(function* (headers: Headers.Headers) {
					if (Option.contains(expected, yield* hash(headers['authorization'] ?? ''))) return PEER
					return yield* auth.user(headers)
				})
			})
		)
	})
)
type RemoteClient = Effect.Success<typeof makeRemoteClient>

function asDeployError<A, E>(effect: Effect.Effect<A, E>) {
	return Effect.mapError(effect, cause => {
		if (Schema.is(DeployError)(cause)) return cause
		return DeployError.make({cause, message: 'Worker exposure change failed'})
	})
}

// A worker's last saved history, windowed to the range the page asked for.
function cachedHistory(query: HistoryQuery, time: DateTime.Utc, saved: Option.Option<MachineHistory>) {
	return {
		cpuModel: Option.flatMap(saved, machine => machine.cpuModel),
		disks: Option.match(saved, {onNone: () => [], onSome: machine => machine.disks}),
		load: Option.match(saved, {onNone: () => [], onSome: machine => machine.load}),
		samples: history(Option.match(saved, {onNone: () => [], onSome: machine => machine.samples}), query.minutes, time),
		time
	}
}

export class Fleet extends Context.Service<
	Fleet,
	{
		readonly expose: (input: ExposeRequest) => Effect.Effect<string, DeployError>
		readonly hide: (input: HideRequest) => Effect.Effect<void, DeployError>
		readonly run: (input: RunRequest) => Effect.Effect<void, DeployError>
		readonly local: Effect.Effect<Snapshot>
		readonly history: (query: HistoryQuery) => Effect.Effect<MachineHistory, DeployError>
		readonly current: (query: HistoryQuery) => Effect.Effect<MachineHistory[], DeployError>
		readonly metrics: (query: HistoryQuery) => Effect.Effect<MachineHistory[], DeployError>
		readonly snapshot: Effect.Effect<Snapshot>
	}
>()('@deslop/deploy/services/fleet/service/Fleet') {
	static readonly layer = Layer.effect(
		this,
		Effect.gen(function* () {
			const inventory = yield* Inventory
			const metrics = yield* Metrics
			const lastMetrics = yield* Ref.make(HashMap.empty<readonly [WorkerId, Duration.Duration], MachineHistory>())
			const exposures = yield* Exposures
			const workers = yield* Effect.forEach(
				yield* Config.withDefault(Config.Array(Schema.String, 'DEPLOY_WORKERS'), []),
				entry => {
					const [name, url] = String.split(entry, '=')
					return Schema.decodeUnknownEffect(Worker)({name, url})
				},
				{concurrency: 1}
			)
			// Each worker's Deploy accepts the others by the key all their env files hold, on any network.
			const peerHeaders = Option.match(yield* Config.option(Config.Redacted('DEPLOY_KEY')), {
				onNone: () => ({}),
				onSome: key => ({authorization: `Bearer ${Redacted.value(key)}`})
			})
			// The fleet layer owns one reconnecting transport per peer. All RPC kinds
			// multiplex over it; a request's timeout never closes another request's link.
			const clients = yield* Effect.forEach(workers, worker =>
				Effect.gen(function* () {
					const url = new URL(RPC_PATH, worker.url)
					url.protocol = new URL(worker.url).protocol === 'http:' ? 'ws:' : 'wss:'
					const protocol = yield* Layer.build(
						pipe(
							RpcClient.layerProtocolSocket({pingTimeout: Duration.seconds(15)}),
							Layer.provide(NodeSocket.layerWebSocket(url.href)),
							Layer.provide(RpcSerialization.layerSchemaBinary()),
							Layer.provideMerge(layerRpcStreamClient)
						)
					)
					return [worker.name, yield* Effect.provideContext(makeRemoteClient, protocol)] as const
				})
			)
			const peers = Record.fromEntries(clients)
			const previous = yield* Ref.make<Record<WorkerId, Snapshot>>({})
			const local = Effect.withSpan(
				Effect.gen(function* () {
					const snapshot = yield* inventory.snapshot
					// Owned exposures are one more source: a failed read shows as its error, as an inventory source's does.
					const owned = yield* Effect.match(exposures.items, {
						onFailure: cause => ({items: [], sources: [{error: Option.some(cause.message), name: 'Exposures'}]}),
						onSuccess: items => ({items, sources: []})
					})
					return Snapshot.make({
						...snapshot,
						items: [...snapshot.items, ...owned.items],
						sources: [...snapshot.sources, ...owned.sources],
						workers: Option.some(
							Array.dedupe([
								...Option.getOrElse(snapshot.workers, () => Array.map(snapshot.items, item => item.worker)),
								...Array.map(workers, worker => worker.name)
							])
						)
					})
				}),
				'Fleet.local'
			)
			const remote = Effect.fn('Fleet.remote')(
				function* <A, E>(worker: Worker, use: (client: RemoteClient, headers: Headers.Input) => Effect.Effect<A, E>) {
					yield* Effect.annotateCurrentSpan('worker', worker.name)
					return yield* use(Option.getOrThrow(Record.get(peers, worker.name)), peerHeaders)
				},
				Effect.timeout(Duration.seconds(15))
			)
			function selectedWorker(target: WorkerId) {
				return pipe(
					workers,
					Array.findFirst(worker => worker.name === target),
					Effect.fromOption,
					Effect.mapError(cause =>
						DeployError.make({cause, message: 'This worker is not configured on the control plane'})
					)
				)
			}
			return Fleet.of({
				current: Effect.fn('Fleet.current')(function* (query) {
					yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes), workers: workers.length + 1})
					const own = yield* metrics.read(query)
					const time = yield* DateTime.now
					const cached = yield* Ref.get(lastMetrics)
					return [
						own,
						...Array.map(workers, worker => {
							const saved = HashMap.get(cached, [worker.name, query.minutes])
							return {
								...cachedHistory(query, time, saved),
								error: Option.match(saved, {
									onNone: () => Option.some('Waiting for worker'),
									onSome: machine => machine.error
								}),
								stale: Option.match(saved, {
									onNone: () => true,
									onSome: machine =>
										machine.stale ||
										pipe(machine.time, DateTime.distance(time), Duration.isGreaterThan(Duration.seconds(90)))
								}),
								worker: worker.name
							}
						})
					]
				}),
				expose: Effect.fn('Fleet.expose')(function* (input) {
					yield* Effect.annotateCurrentSpan({exposure: input.name, worker: Option.getOrElse(input.target, hostname)})
					if (Option.isNone(input.target)) {
						return yield* exposures.expose(Struct.omit(input, ['target']))
					}
					return yield* remote(yield* selectedWorker(Option.getOrThrow(input.target)), (client, headers) =>
						client('exposures.expose', {...input, target: Option.none()}, {headers})
					)
				}, asDeployError),
				hide: Effect.fn('Fleet.hide')(function* (input) {
					yield* Effect.annotateCurrentSpan({exposure: input.name, worker: Option.getOrElse(input.target, hostname)})
					if (Option.isNone(input.target)) return yield* exposures.hide(input.name)
					return yield* remote(yield* selectedWorker(Option.getOrThrow(input.target)), (client, headers) =>
						client('exposures.hide', {name: input.name, target: Option.none()}, {headers})
					)
				}, asDeployError),
				history: Effect.fn('Fleet.history')(function* (query) {
					yield* Effect.annotateCurrentSpan('minutes', Duration.toMinutes(query.minutes))
					return yield* metrics.read(query)
				}),
				local,
				metrics: Effect.fn('Fleet.metrics')(function* (query) {
					yield* Effect.annotateCurrentSpan({minutes: Duration.toMinutes(query.minutes), workers: workers.length + 1})
					const own = yield* metrics.read(query)
					const others = yield* Effect.forEach(
						workers,
						worker =>
							pipe(
								remote(worker, (client, headers) => client('metrics.history', query, {headers})),
								Effect.timeout(Duration.seconds(2)),
								Effect.map(value => ({...value, worker: worker.name})),
								Effect.catch(
									Effect.fnUntraced(function* (cause) {
										return {
											...cachedHistory(
												query,
												yield* DateTime.now,
												HashMap.get(yield* Ref.get(lastMetrics), [worker.name, query.minutes])
											),
											error: Option.some(cause.message),
											stale: true,
											worker: worker.name
										}
									})
								),
								Effect.tap(value =>
									Ref.update(lastMetrics, all => HashMap.set(all, [worker.name, query.minutes], value))
								)
							),
						{concurrency: 'unbounded'}
					)
					return [own, ...others]
				}),
				run: Effect.fn('Fleet.run')(
					function* (input) {
						yield* Effect.annotateCurrentSpan({job: input.name, worker: Option.getOrElse(input.target, hostname)})
						if (Option.isNone(input.target)) {
							return yield* inventory.run(Struct.omit(input, ['target']))
						}
						return yield* remote(yield* selectedWorker(Option.getOrThrow(input.target)), (client, headers) =>
							client('inventory.run', {...input, target: Option.none()}, {headers})
						)
					},
					Effect.mapError(cause => {
						if (Schema.is(DeployError)(cause)) return cause
						return DeployError.make({cause, message: 'Worker could not start the job'})
					})
				),
				snapshot: Effect.withSpan(
					Effect.gen(function* () {
						const own = yield* local
						const others = yield* Effect.forEach(
							workers,
							worker =>
								pipe(
									remote(worker, (client, headers) => client('inventory.snapshot', undefined, {headers})),
									Effect.timeout(Duration.seconds(2)),
									Effect.map(snapshot =>
										Snapshot.make({
											...snapshot,
											items: Array.map(snapshot.items, item => ({
												...item,
												id: ItemId.make(`remote:${worker.name}:${item.id}`),
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
											Effect.map(Ref.get(previous), rows => ({
												items: rows[worker.name]?.items ?? [],
												sources: [{error: Option.some(cause.message), name: `${worker.name} · Snapshot`}]
											})),
										onSuccess: Effect.succeed
									})
								),
							{concurrency: 'unbounded'}
						)
						return Snapshot.make({
							items: [...own.items, ...Array.flatMap(others, value => value.items)],
							sources: [...own.sources, ...Array.flatMap(others, value => value.sources)],
							time: yield* DateTime.now,
							workers: Option.some(
								Array.dedupe([
									...Option.getOrElse(own.workers, Array.empty),
									...Array.map(workers, worker => worker.name)
								])
							)
						})
					}),
					'Fleet.snapshot',
					{attributes: {workers: workers.length + 1}}
				)
			})
		})
	)
}
