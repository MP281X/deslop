import type {View} from '@effect/ui'

import {Function, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {Loading, Notice} from '@deslop/ui/axis'

import {Message, readValue} from '#web/auth/model.ts'
import type {H, Reader} from '#web/auth/model.ts'

export function ReadProblem(h: H, result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader) {
	const failure = blockingFailure(result)
	const retry = Message.Retry({reader})
	if (Option.exists(failure, needsSignInCause)) return Notice(h, 'Signing in…')
	if (Option.exists(failure, isDeniedCause)) return Notice(h, 'Access denied')
	if (Option.isSome(failure)) return Notice(h, `Couldn’t load ${reader}`, retry)
	if (AsyncResult.isFailure(result))
		return h.aside.class('auth-read-problem').children(Notice(h, `Couldn’t refresh ${reader}`, retry))
	return undefined
}

export function ReadPane<A>(
	h: H,
	result: AsyncResult.AsyncResult<A, unknown>,
	reader: Reader,
	loading: View.Input<Message>,
	content: (value: A) => View.Input<Message>
) {
	if (AsyncResult.isInitial(result)) return Loading(h, `Loading ${reader}`, loading)
	return h.div.children(
		Option.match(readValue(result), {onNone: Function.constUndefined, onSome: content}),
		ReadProblem(h, result, reader)
	)
}

export function ListSkeleton(h: H) {
	return h.div.class('auth-skeleton-list').attr('aria-hidden', 'true')
}

export function DetailSkeleton(h: H, sessions: boolean) {
	return h.div
		.class('auth-skeleton-detail')
		.attr('aria-hidden', 'true')
		.children(sessions && ListSkeleton(h))
}
