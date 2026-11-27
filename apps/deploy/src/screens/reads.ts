import {Command} from '@effect/ui'

import {Context, Effect, Function, Layer, Option, Predicate, Schema, Stream, String, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {liveAtom} from '@deslop/runtime/client/live-stream'
import type {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import type {Account} from '@deslop/runtime/shared/schema'

import {AppId, ExposeInput, RpcContracts, RunRequest} from '#contracts'

import {HOUR} from '#screens/chart.ts'

export type Operation = typeof Operation.Type
export const Operation = Schema.TaggedUnion({
	Expose: {input: ExposeInput},
	Logs: {id: AppId},
	Restart: {id: AppId},
	Run: {request: RunRequest},
	Stop: {id: AppId}
})

export function observe<A, M>(atom: Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(
		AtomRegistry.AtomRegistry.useSync(registry => pipe(registry, AtomRegistry.toStream(atom), Stream.map(read)))
	)
}

function reads(
	protocol: ReturnType<typeof layerSocketProtocol>,
	account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
) {
	const credentials = Atom.make(0)
	class Client extends AtomRpc.Service<Client>()('Deploy/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: get => {
			get(credentials)
			return Layer.fresh(protocol)
		}
	}) {}

	const inventory = liveAtom(Client, 'inventory.watch')
	const metrics = liveAtom(Client, 'metrics.watch', {minutes: HOUR})
	const app = Atom.family((id: AppId) => liveAtom(Client, 'metrics.app', {id}))
	const operation = Client.runtime.fn((request: Operation) =>
		Effect.flatMap(Client, call =>
			Operation.match(request, {
				Expose: input => Effect.as(call('exposures.expose', input.input), Option.none<string>()),
				Logs: input => Effect.asSome(call('inventory.logs', {id: input.id})),
				Restart: input => Effect.as(call('inventory.restart', {id: input.id}), Option.none<string>()),
				Run: input => Effect.as(call('inventory.run', input.request), Option.none<string>()),
				Stop: input => Effect.as(call('inventory.stop', {id: input.id}), Option.none<string>())
			})
		)
	)
	return {account, app, credentials, inventory, metrics, operation}
}

export class DeployReads extends Context.Service<DeployReads, ReturnType<typeof reads>>()('Deploy/Reads') {
	static layer(
		protocol: ReturnType<typeof layerSocketProtocol>,
		account: Atom.Atom<AsyncResult.AsyncResult<Account, AuthError>>
	) {
		return Layer.succeed(this, reads(protocol, account))
	}
}

export class Execute extends Command.Service<Execute>()('Deploy/Execute', {
	args: {operation: Operation},
	error: Schema.String,
	success: Schema.Option(Schema.String)
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const {operation} = yield* DeployReads
			const registry = yield* AtomRegistry.AtomRegistry
			return request =>
				Effect.mapError(
					Effect.suspend(() => {
						registry.set(operation, request.operation)
						return AtomRegistry.getResult(registry, operation, {suspendOnWaiting: true})
					}),
					error => {
						if (Predicate.isError(error)) return error.message
						return String.String(error)
					}
				)
		})
	)
}

function refreshFailed<A, E>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
	if (AsyncResult.isFailure(registry.get(atom))) registry.refresh(atom)
}

export class Refresh extends Command.Service<Refresh>()('Deploy/Refresh', {
	args: {authenticated: Schema.Boolean, id: Schema.Option(AppId)}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* DeployReads
			const registry = yield* AtomRegistry.AtomRegistry
			return request =>
				Effect.sync(() => {
					registry.refresh(reads.account)
					// The session cookie is carried by the upgrade; reopen the socket after a successful sign-in.
					if (request.authenticated) {
						registry.update(reads.credentials, version => version + 1)
						return
					}
					refreshFailed(registry, reads.inventory)
					refreshFailed(registry, reads.metrics)
					Option.match(request.id, {onNone: Function.constVoid, onSome: id => refreshFailed(registry, reads.app(id))})
				})
		})
	)
}

export class Authenticate extends Command.Service<Authenticate>()('Deploy/Authenticate', {
	args: {},
	error: AuthError,
	success: Schema.Boolean
}) {}

export function readDeploy<A, M>(pick: (reads: ReturnType<typeof reads>) => Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(DeployReads.useSync(reads => observe(pick(reads), read)))
}

export class OpenEndpoint extends Command.Service<OpenEndpoint>()('Deploy/OpenEndpoint', {
	args: {url: Schema.String}
}) {}
