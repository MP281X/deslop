import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Array, Option, pipe} from 'effect'

import type {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause, needsSignInCause} from '@deslop/runtime/client/live-stream'
import {Loading, Notice} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {SymbolIcon} from '@deslop/ui/symbol'

export function RowContent<M>(
	h: Html.H<M>,
	options: {leading?: View.Input<M>; line: View.Input<M>; problem?: boolean; title: View.Input<M>; value: View.Input<M>}
) {
	return [
		h.div
			.class('axis-row-lead')
			.children(
				options.leading,
				h.span
					.class('axis-lines')
					.children(
						h.span
							.class('axis-title')
							.children(
								options.problem === true && h.span.class('axis-dot').attr('aria-hidden', 'true'),
								options.title
							),
						h.span.class('axis-muted').children(options.line)
					)
			),
		h.div.class('axis-value').children(options.value)
	]
}

export function ReadState<M>(
	h: Html.H<M>,
	options: {
		content: Option.Option<View.Input<M>>
		label: string
		loading: View.Input<M>
		reads: readonly AsyncResult.AsyncResult<unknown, unknown>[]
		retry: M
	}
) {
	return pipe(options.reads, Array.findFirst(blockingFailure), Option.match({
		onNone: () => Option.getOrElse(options.content, () => Loading(h, `Loading ${options.label}`, options.loading)),
		onSome: failure => {
			if (needsSignInCause(failure)) return Notice(h, 'Signing in…')
			if (isDeniedCause(failure)) return Notice(h, 'Access denied')
			return Notice(h, `Couldn’t load ${options.label}`, options.retry)
		}
	}))
}

export function WebSignOut<M>(h: Html.H<M>, next: string) {
	return h.form
		.attrs({action: `/auth/sign-out?${new URLSearchParams({next})}`, method: 'post'})
		.children(
			Button(h, {type: 'submit'})
				.attr('role', 'menuitem')
				.children('Sign out', SymbolIcon(h, 'rectangle.portrait.and.arrow.right'))
		)
}
