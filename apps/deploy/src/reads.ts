import {Command, Route} from '@effect/ui'

import {Context, Effect, Layer, Option, Predicate, Schema, Stream, String} from 'effect'

import {Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'
import type {AsyncResult} from 'effect/reactivity'

import {HOUR} from '@deslop/components/chart'
import {liveAtom} from '@deslop/runtime/client/live-stream'
import {Shell, observeRead} from '@deslop/runtime/client/shell'
import {RpcStream} from '@deslop/runtime/shared/rpc'

import {RpcContracts} from './contracts.ts'

import {ExposeInput} from '#exposures/contract.ts'
import {AppId, ItemId, RunRequest} from '#inventory/contract.ts'

export type Operation = typeof Operation.Type
export const Operation = Schema.TaggedUnion({
	Expose: {input: ExposeInput},
	Logs: {id: AppId},
	Restart: {id: AppId},
	Run: {request: RunRequest},
	Stop: {id: AppId}
})

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('Deploy/Rpc', {
		group: RpcContracts.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	const inventoryAtom = liveAtom(Client, 'inventory.watch')
	const metricsAtom = liveAtom(Client, 'metrics.watch', {minutes: HOUR})
	const appAtoms = Atom.family((id: AppId) => liveAtom(Client, 'metrics.app', {id}))
	const operationAtom = Client.runtime.fn((request: Operation) =>
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
	return {
		account: shell.account,
		app: appAtoms,
		inventory: inventoryAtom,
		metrics: metricsAtom,
		operation: operationAtom
	}
}

class DeployReads extends Context.Service<DeployReads, ReturnType<typeof makeReads>>()(
	'@deslop/deploy/reads/DeployReads'
) {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

export class Execute extends Command.Service<Execute>()('Deploy/Execute', {
	args: {operation: Operation},
	error: Schema.String,
	success: Schema.Option(Schema.String)
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const reads = yield* DeployReads
			const registry = yield* AtomRegistry.AtomRegistry
			return request =>
				Effect.mapError(
					Effect.suspend(() => {
						registry.set(reads.operation, request.operation)
						return AtomRegistry.getResult(registry, reads.operation, {suspendOnWaiting: true})
					}),
					error => {
						if (Predicate.isError(error)) return error.message
						return String.String(error)
					}
				)
		})
	)
}

// Deploy's own part of what an app mounts on: its reads, and the operations that run on them.
export const layerDeploy = Layer.provideMerge(Execute.layer, DeployReads.layer)

export function readDeploy<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(DeployReads.useSync(reads => observeRead(pick(reads), read)))
}

export const DeployRoute = Route.union({
	Home: Route.make('/', {
		search: {app: Schema.optional(ItemId), pane: Schema.optional(Schema.Literals(['apps', 'process']))}
	}),
	NotFound: Route.make('/*')
})

export type DeployRoute = typeof DeployRoute.Type

export function isDetail(route: DeployRoute) {
	return DeployRoute.isAnyOf(['Home'])(route) && route.search.app !== undefined && route.search.pane !== 'apps'
}

export function appOf(route: DeployRoute) {
	if (DeployRoute.isAnyOf(['Home'])(route)) return route.search.app
	return undefined
}
