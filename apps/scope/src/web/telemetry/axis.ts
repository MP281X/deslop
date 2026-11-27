import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Cause, Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {isDenied} from '@deslop/runtime/shared/auth'
import {Loading, Notice} from '@deslop/ui/axis'

export function RowContent<M>(
	h: Html.H<M>,
	options: {title: View.Input<M>; line: View.Input<M>; value: View.Input<M>; problem?: boolean}
) {
	return [
		h.span
			.class('axis-lines')
			.children(
				h.span.class('axis-title').children(options.problem === true && h.span.class('axis-dot'), options.title),
				h.span.class('axis-muted').children(options.line)
			),
		h.span.class('axis-value').children(options.value)
	]
}

export function ReadFailure<M>(h: Html.H<M>, cause: Cause.Cause<unknown>, retry: M) {
	if (isDenied(Cause.squash(cause))) return Notice(h, 'Access denied')
	return Notice(h, 'Couldn’t load', retry)
}

export function ReadState<M, A, E>(
	h: Html.H<M>,
	result: AsyncResult.AsyncResult<A, E>,
	options: {label: string; skeleton: View.Input<M>; ready: (value: A) => View.Input<M>; retry: M}
) {
	return Option.match(blockingFailure(result), {
		onNone: () =>
			Option.match(AsyncResult.value(result), {
				onNone: () => Loading(h, options.label, options.skeleton),
				onSome: options.ready
			}),
		onSome: cause => ReadFailure(h, cause, options.retry)
	})
}
