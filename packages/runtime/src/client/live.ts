import {Array, Cause, Effect, Function, MutableRef, Option, Schedule, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import type {Atom, AtomRegistry} from 'effect/reactivity'

import {AuthError, isDenied} from '#shared/auth.ts'

// Observe the read before recovery can swallow its refusal, since only a real emission restores authorization.
export function withoutDeniedData<A, E, R>(
	get: Atom.AtomContext,
	source: Stream.Stream<A, E, R>,
	recover: (stream: Stream.Stream<A, E, R>) => Stream.Stream<A, E, R | AtomRegistry.AtomRegistry> = Function.identity
) {
	function denials(cause: Cause.Cause<E>) {
		const reasons = Array.filter(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))
		if (Array.isArrayEmpty(reasons)) return Option.none()
		return Option.some(Cause.fromReasons(reasons))
	}
	const denied = MutableRef.make(
		pipe(
			get.self<AsyncResult.AsyncResult<A, E>>(),
			Option.filter(AsyncResult.isFailure),
			Option.flatMap(result => denials(result.cause))
		)
	)
	function gated(cause: Cause.Cause<E>) {
		return Option.match(MutableRef.get(denied), {
			onNone: () => cause,
			onSome: refusal =>
				Cause.fromReasons([
					...refusal.reasons,
					...Array.filter(cause.reasons, reason => !Cause.isFailReason(reason) || !isDenied(reason.error))
				])
		})
	}
	// A dropped socket, as after a hidden tab or a suspended app, usually heals on the first retry; only a second miss in a row is an outage worth showing.
	const misses = MutableRef.make(0)
	const observed = pipe(
		source,
		Stream.tapCause(cause =>
			Effect.sync(() => {
				MutableRef.update(denied, previous => Option.orElse(denials(cause), () => previous))
				const failure = gated(cause)
				if (Option.isSome(MutableRef.get(denied))) {
					get.setSelf(AsyncResult.failure(failure))
					return
				}
				if (MutableRef.incrementAndGet(misses) < 2) return
				get.setSelf(AsyncResult.failureWithPrevious(failure, {previous: get.self<AsyncResult.AsyncResult<A, E>>()}))
			})
		)
	)
	return pipe(
		recover(observed),
		Stream.tap(() =>
			Effect.sync(() => {
				MutableRef.set(denied, Option.none())
				MutableRef.set(misses, 0)
			})
		),
		Stream.catchCause(cause => Stream.failCause(gated(cause))),
		Stream.concat(
			Stream.suspend(() => Option.match(MutableRef.get(denied), {onNone: () => Stream.empty, onSome: Stream.failCause}))
		)
	)
}

// A live stream recovers from transport and authorization outages, never a refusal or domain failure.
export function reconnecting<A, E extends {_tag: string}, R>(stream: Stream.Stream<A, E, R>) {
	return pipe(
		stream,
		Stream.retry($ =>
			pipe(
				$(Schedule.spaced('1 second')),
				Schedule.while(
					metadata =>
						metadata.input._tag === 'RpcClientError' ||
						(Schema.is(AuthError)(metadata.input) && metadata.input.error === 'temporarily_unavailable')
				)
			)
		)
	)
}

// The one way to read a live RPC stream: an outage keeps its content, a refusal clears it, and a transport miss reconnects.
export function live<A, E extends {_tag: string}, R>(get: Atom.AtomContext, stream: Stream.Stream<A, E, R>) {
	return withoutDeniedData(get, stream, reconnecting)
}
