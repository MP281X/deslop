import {Array, Function, Option} from 'effect'
import type {DateTime} from 'effect'

import {ageOf} from '@deslop/runtime/shared/format'

import {readValue} from '#web/auth/model.ts'
import type {H, Model} from '#web/auth/model.ts'
import {rowLine} from '#web/auth/row.ts'
import {Notice, ReadProblem} from '#web/auth/status.ts'
import {browserOf, deviceOf} from '#web/sessions/browser.ts'

export function Sessions(h: H, result: Model['sessions'], now: DateTime.Utc) {
	return h.section.attr('aria-label', 'Browser sessions').children(
		Option.match(readValue(result), {
			onNone: Function.constUndefined,
			onSome: rows => {
				if (Array.isReadonlyArrayEmpty(rows)) return Notice(h, 'No browser sessions')
				return Array.map(rows, session =>
					h.div
						.key(session.id)
						.class('axis-row')
						.children(
							h.span
								.class('auth-row-name')
								.children(
									h.span
										.class('axis-title')
										.children(rowLine([browserOf(session.browser), Option.getOrUndefined(deviceOf(session.browser))])),
									h.span
										.class('axis-muted')
										.children(rowLine([Option.getOrUndefined(session.address), session.current && 'This device']))
								),
							h.span.class('axis-value').children(ageOf(session.lastSeenAt, now))
						)
				)
			}
		}),
		ReadProblem(h, result, 'sessions')
	)
}
