import {Command} from '@effect/ui'

import {Context, Effect, Layer, Option, Schema, Stream, pipe} from 'effect'

import {AsyncResult, Atom, AtomRegistry, AtomRpc} from 'effect/reactivity'

import {clockAtom} from '@deslop/runtime/client/clock'
import {liveAtom} from '@deslop/runtime/client/live-stream'
import type {layerSocketProtocol} from '@deslop/runtime/client/protocol'
import {AuthError} from '@deslop/runtime/shared/auth'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {TelemetryRpc, TraceId} from '#contracts'

function reads(protocol: ReturnType<typeof layerSocketProtocol>) {
	const credentials = Atom.make(0)
	class Client extends AtomRpc.Service<Client>()('Scope/Rpc', {
		group: TelemetryRpc.middleware(RpcStream),
		protocol: get => {
			get(credentials)
			return Layer.fresh(protocol)
		}
	}) {}

	return {
		credentials,
		now: clockAtom('30 seconds'),
		overview: Atom.family((range: TimeFrame) => liveAtom(Client, 'telemetry.watch', range)),
		trace: Atom.family((id: TraceId) => liveAtom(Client, 'telemetry.trace', {id}))
	}
}

export class ScopeReads extends Context.Service<ScopeReads, ReturnType<typeof reads>>()('Scope/Reads') {
	static layer(protocol: ReturnType<typeof layerSocketProtocol>) {
		return Layer.succeed(this, reads(protocol))
	}
}

export function observe<A, M>(pick: (source: ReturnType<typeof reads>) => Atom.Atom<A>, read: (value: A) => M) {
	return Stream.unwrap(
		ScopeReads.useSync(source =>
			Stream.unwrap(
				AtomRegistry.AtomRegistry.useSync(registry =>
					pipe(registry, AtomRegistry.toStream(pick(source)), Stream.map(read))
				)
			)
		)
	)
}

function refreshFailed<A, E>(registry: AtomRegistry.AtomRegistry, atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>) {
	if (AsyncResult.isFailure(registry.get(atom))) registry.refresh(atom)
}

export class Retry extends Command.Service<Retry>()('Scope/Retry', {
	args: {newSession: Schema.Boolean, range: TimeFrame, trace: Schema.Option(TraceId)}
}) {
	static readonly layer = this.toLayer(
		Effect.gen(function* () {
			const source = yield* ScopeReads
			const registry = yield* AtomRegistry.AtomRegistry
			return args =>
				Effect.sync(() => {
					if (args.newSession) {
						registry.update(source.credentials, version => version + 1)
						return
					}
					refreshFailed(registry, source.overview(args.range))
					Option.map(args.trace, id => refreshFailed(registry, source.trace(id)))
				})
		})
	)
}

export class Authenticate extends Command.Service<Authenticate>()('Scope/Authenticate', {
	args: {},
	error: AuthError,
	success: Schema.Boolean
}) {}

export class OpenLink extends Command.Service<OpenLink>()('Scope/OpenLink', {args: {url: Schema.String}}) {}
