import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Option} from 'effect'

import type {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause} from '@deslop/runtime/client/live-stream'
import {Button} from '@deslop/ui/control'

export function readProblem(
	account: AsyncResult.AsyncResult<unknown, unknown>,
	content: AsyncResult.AsyncResult<unknown, unknown>
) {
	const access = blockingFailure(account)
	if (Option.exists(access, isDeniedCause)) return access
	return Option.orElse(blockingFailure(content), () => access)
}

export function signOutForm<M>(h: Html.H<M>, next: string) {
	return h.form
		.attrs({action: `/auth/sign-out?${new URLSearchParams({next})}`, method: 'post'})
		.children(Button(h, {type: 'submit'}).children('Sign out'))
}

export function RowPlaceholder<M>(
	h: Html.H<M>,
	options: {
		className?: string
		id: string
		leading?: View.Input<M>
		line: View.Input<M>
		title: View.Input<M>
		value: View.Input<M>
	}
) {
	return h.div
		.key(options.id)
		.class('axis-row axis-item', options.className)
		.attr('aria-hidden', 'true')
		.children(options.leading, h.span.class('axis-lines').children(options.title, options.line), options.value)
}
