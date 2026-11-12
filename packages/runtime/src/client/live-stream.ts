import {Array, Cause, Effect, Function, MutableRef, Option, Schedule, Schema, Stream, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import type {Atom, AtomRegistry} from 'effect/reactivity'
import {RpcClientError} from 'effect/rpc'

import {AuthError, isDenied} from '#shared/auth.ts'

// Whether a failure holds a refusal: a sign-in the server no longer accepts or access it does not grant.
export function isDeniedCause(cause: Cause.Cause<unknown>) {
	return Array.some(cause.reasons, reason => Cause.isFailReason(reason) && isDenied(reason.error))
}

// The failure a screen shows in place of a read's content: any refusal, or an outage with nothing kept.
export function blockingFailure<A, E>(result: AsyncResult.AsyncResult<A, E>) {
	if (!AsyncResult.isFailure(result)) return Option.none<Cause.Cause<E>>()
	if (!isDeniedCause(result.cause) && Option.isSome(result.previousSuccess)) return Option.none<Cause.Cause<E>>()
	return Option.some(result.cause)
}

// An atom's live read keeps its last value through an outage and clears it on a refusal; it observes the read before `recover` can swallow a refusal, since only a real emission restores authorization.
export function keepValueThroughOutages<A, E, R>(
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
	const observed = Stream.tapCause(source, cause =>
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

// Reopens a stream each second after a dropped transport or an authorization outage, never after a refusal, a domain failure or a frame it cannot read.
export function reconnectOnDrop<A, E, R>(stream: Stream.Stream<A, E, R>) {
	return Stream.retry(stream, $ =>
		Schedule.while($(Schedule.spaced('1 second')), metadata => {
			if (Schema.is(AuthError)(metadata.input)) return metadata.input.error === 'temporarily_unavailable'
			return (
				Schema.is(RpcClientError.RpcClientError)(metadata.input) && metadata.input.reason._tag !== 'RpcClientDefect'
			)
		})
	)
}
