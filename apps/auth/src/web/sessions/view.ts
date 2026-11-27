import {Array, Option} from 'effect'
import type {DateTime} from 'effect'

import {ageOf} from '@deslop/runtime/shared/format'
import {Notice} from '@deslop/ui/axis'

import type {H, Model} from '#web/auth/model.ts'
import {ListSkeleton, ReadPane} from '#web/auth/reading.ts'
import {rowLine} from '#web/auth/row.ts'
import {browserOf, deviceOf} from '#web/sessions/browser.ts'

export function Sessions(h: H, result: Model['sessions'], now: DateTime.Utc) {
	return h.section.attr('aria-label', 'Browser sessions').children(
		ReadPane(h, result, 'sessions', ListSkeleton(h), rows => {
			if (Array.isReadonlyArrayEmpty(rows)) return Notice(h, 'No browser sessions')
			return Array.map(rows, session =>
				h.div
					.key(session.id)
					.class('axis-row axis-item')
					.children(
						h.span
							.class('axis-lines')
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
		})
	)
}
