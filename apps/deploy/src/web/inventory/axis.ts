import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {Notice} from '@deslop/ui/axis'

// Passive row text has the same slots as a selectable row, without a button.
export function RowLabel<M>(h: Html.H<M>, title: View.Input<M>, line?: View.Input<M>) {
	return h.span
		.class('axis-lines')
		.children(h.span.class('axis-title').children(title), h.span.class('axis-muted').children(line))
}

export function ReadState<M, A, E>(
	h: Html.H<M>,
	result: AsyncResult.AsyncResult<A, E>,
	options: {loading: View.Input<M>; retry: M; unavailable: string; content: (value: A, stale: boolean) => View.Input<M>}
): View.Input<M> {
	if (AsyncResult.isInitial(result)) return options.loading
	if (Option.isSome(blockingFailure(result))) return Notice(h, options.unavailable, options.retry)
	return Option.getOrUndefined(
		Option.map(AsyncResult.value(result), value => options.content(value, AsyncResult.isFailure(result)))
	)
}
