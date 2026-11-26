import {Option} from 'effect'

import {AsyncResult} from 'effect/reactivity'

import {blockingFailure, isDeniedCause} from '@deslop/runtime/client/live-stream'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'

import {Message, signInRequested} from '#web/auth/model.ts'
import type {H, Reader} from '#web/auth/model.ts'

const READER_LABELS = {account: 'Account', people: 'People', sessions: 'Sessions'}

export function Notice(h: H, label: string, reader?: Reader, problem = false) {
	return h.div
		.class('axis-row auth-status')
		.attr('role', 'status')
		.children(
			h.p.class('axis-muted').children(problem && h.span.class('axis-dot').attr('aria-hidden', 'true'), label),
			reader !== undefined &&
				Glass(h).children(
					Button(h)
						.class('auth-action')
						.on('click', () => Message.Retry({reader}))
						.children('Retry')
				)
		)
}

export function ReadProblem(h: H, result: AsyncResult.AsyncResult<unknown, unknown>, reader: Reader) {
	const failure = blockingFailure(result)
	if (Option.isSome(failure)) {
		if (signInRequested(result)) return Notice(h, 'Signing in…')
		if (Option.exists(failure, isDeniedCause)) return Notice(h, 'Access denied', undefined, true)
		return Notice(h, `Couldn’t load ${reader}`, reader, true)
	}
	if (AsyncResult.isFailure(result)) return Notice(h, `${READER_LABELS[reader]} out of date`, reader, true)
	if (AsyncResult.isInitial(result)) return Notice(h, `Loading ${reader}…`)
	return undefined
}
