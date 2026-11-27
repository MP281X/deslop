import type {View} from '@effect/ui'

import {Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {Loading, Notice} from '@deslop/ui/axis'
import {ReadFailure, ReadState} from '@deslop/ui/state'

import {Message} from '#web/auth/model.ts'
import type {H, Reader} from '#web/auth/model.ts'

export function ReadProblem(h: H, result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader) {
	const failure = Option.getOrUndefined(blockingFailure(result))
	if (failure !== undefined) return ReadFailure(h, failure, `Couldn’t load ${reader}`, Message.Retry({reader}))
	if (AsyncResult.isFailure(result)) {
		return h.aside.class('auth-read-problem').children(Notice(h, `Couldn’t refresh ${reader}`, Message.Retry({reader})))
	}
	return undefined
}

export function ReadPane<A>(
	h: H,
	result: AsyncResult.AsyncResult<A, unknown>,
	reader: Reader,
	loading: View.Input<Message>,
	content: (value: A) => View.Input<Message>
) {
	return ReadState(result, {
		failed: cause => ReadFailure(h, cause, `Couldn’t load ${reader}`, Message.Retry({reader})),
		loading: () => Loading(h, `Loading ${reader}`, loading),
		ready: (value, stale) => h.div.children(content(value), stale && ReadProblem(h, result, reader))
	})
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
