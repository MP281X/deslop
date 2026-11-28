import {Route} from '@effect/ui'

import {Context, Effect, Function, Layer, Option, Schema, Stream} from 'effect'

import {Atom, AtomRpc} from 'effect/reactivity'
import type {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause, liveAtom, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {Shell, observeRead} from '@deslop/runtime/client/shell'
import {RpcStream} from '@deslop/runtime/shared/rpc'
import {TimeFrame} from '@deslop/runtime/shared/time'

import {AppName, Runtime, SpanId, TelemetryRpcs, TraceId} from '#telemetry/contract.ts'

const fields = {
	operation: Schema.OptionFromOptionalKey(Schema.String),
	pane: Schema.OptionFromOptionalKey(Schema.Literals(['Traces', 'Trace', 'Span'])),
	range: Schema.OptionFromOptionalKey(TimeFrame),
	side: Schema.OptionFromOptionalKey(Runtime),
	source: Schema.OptionFromOptionalKey(AppName),
	span: Schema.OptionFromOptionalKey(SpanId),
	trace: Schema.OptionFromOptionalKey(TraceId)
}

export const ScopeRoute = Route.union({
	Home: Route.make('/', {search: fields}),
	Other: Route.make('/*', {search: fields})
})

export type ScopeRoute = typeof ScopeRoute.Type
export type Search = ScopeRoute['search']

export function rangeOf(search: Search) {
	return Option.getOrElse(search.range, Function.constant('24h' as const))
}

// How deep the URL goes: the list, then an operation's traces, a trace and a span, of which the iPhone shows each on a page of its own.
export function levelOf(search: Search, iphone = false) {
	if (Option.isSome(search.span)) {
		if (iphone) return 3
		return 2
	}
	if (iphone && Option.contains(search.pane, 'Trace')) return 2
	if (Option.isSome(search.pane) || Option.isSome(search.operation) || Option.isSome(search.trace)) return 1
	return 0
}

function makeReads(shell: Context.Service.Shape<typeof Shell>) {
	class Client extends AtomRpc.Service<Client>()('Scope/Rpc', {
		group: TelemetryRpcs.middleware(RpcStream),
		protocol: shell.protocol
	}) {}

	return {
		overview: Atom.family((range: TimeFrame) => liveAtom(Client, 'telemetry.watch', range)),
		trace: Atom.family((id: TraceId) => liveAtom(Client, 'telemetry.trace', {id}))
	}
}

class ScopeReads extends Context.Service<ScopeReads, ReturnType<typeof makeReads>>()('@deslop/scope/reads/ScopeReads') {
	static readonly layer = Layer.effect(this, Effect.map(Shell, makeReads))
}

// Scope's own part of what a host mounts on: its reads.
export const layerScope = ScopeReads.layer

export function readScope<A extends AsyncResult.AsyncResult<unknown, unknown>, M>(
	pick: (reads: ReturnType<typeof makeReads>) => Atom.Atom<A>,
	read: (value: A) => M
) {
	return Stream.unwrap(ScopeReads.useSync(reads => observeRead(pick(reads), read)))
}

export type Failure = typeof Failure.Type
const Failure = Schema.Literals(['denied', 'failed', 'sign-in'])

// Why a read shows no content, if it does not: the server asks for a sign-in, refuses the account, or has failed with nothing kept.
export function failureOf(result: AsyncResult.AsyncResult<unknown, unknown>) {
	return Option.map(blockingFailure(result), cause => {
		if (needsSignInCause(cause)) return Failure.make('sign-in')
		if (isDeniedCause(cause)) return Failure.make('denied')
		return Failure.make('failed')
	})
}
