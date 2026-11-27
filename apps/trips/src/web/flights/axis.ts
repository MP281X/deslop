import {Command} from '@effect/ui'
import type {View} from '@effect/ui'
import {Html, HtmlCommand} from '@effect/ui/html'

import {Option} from 'effect'
import type {Cause} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure} from '@deslop/runtime/client/live-stream'

export function RowContent<M>(
	h: Html.H<M>,
	options: {
		title: View.Input<M>
		leading?: View.Input<M>
		line?: View.Input<M>
		problem?: boolean
		value?: View.Input<M>
	}
) {
	return [
		options.leading,
		h.span
			.class('axis-lines')
			.children(
				h.span.class('axis-title').children(options.problem === true && h.span.class('axis-dot'), options.title),
				h.span.class('axis-muted').children(options.line)
			),
		h.span.class('axis-value').children(options.value)
	]
}

export function ReadState<A, E, M>(
	result: AsyncResult.AsyncResult<A, E>,
	options: {
		loading: () => View.Input<M>
		failed: (reason: Cause.Cause<E>) => View.Input<M>
		ready: (value: A, stale: boolean) => View.Input<M>
	}
) {
	return Option.match(blockingFailure(result), {
			onNone: () =>
				Option.match(AsyncResult.value(result), {
					onNone: options.loading,
					onSome: value => options.ready(value, AsyncResult.isFailure(result))
				}),
			onSome: options.failed
		})
}

const SignOutForm = Html.ref('SignOutForm', 'form')

export function WebSignOut<M>(h: Html.H<M>, next: string) {
	return h.form
		.ref(SignOutForm)
		.attrs({action: `/auth/sign-out?${new URLSearchParams({next})}`, hidden: '', method: 'post'})
}

export const submitWebSignOut = Command.asNoop(HtmlCommand.RequestSubmit.make({ref: SignOutForm}))
