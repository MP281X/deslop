import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Button} from './control.ts'
import {Glass} from './glass.ts'

export function Row<M>(
	h: Html.H<M>,
	options: {
		className?: string
		current: boolean
		id: string
		leading?: View.Input<M>
		line: View.Input<M>
		open: M
		problem?: boolean
		title: View.Input<M>
		value: View.Input<M>
	}
) {
	return Button(h)
		.key(options.id)
		.class('axis-row axis-item', options.className)
		.attr('aria-current', `${options.current}`)
		.on('click', () => options.open)
		.children(
			options.leading,
			h.span
				.class('axis-lines')
				.children(
					h.span.class('axis-title').children(options.problem === true && h.span.class('axis-dot'), options.title),
					h.span.class('axis-muted').children(options.line)
				),
			h.span.class('axis-value').children(options.value)
		)
}

export function Notice<M>(h: Html.H<M>, text: string, action?: M, label = 'Retry') {
	return h.div
		.class('axis-notice')
		.attr('role', 'status')
		.children(
			h.p.children(text),
			action !== undefined &&
				Glass(h).children(
					Button(h)
						.on('click', () => action)
						.children(label)
				)
		)
}

export function Loading<M>(h: Html.H<M>, label: string, content: View.Input<M>) {
	return h.div.attrs({'aria-busy': 'true', 'aria-label': label, role: 'status'}).children(content)
}

export function Placeholder<M>(h: Html.H<M>, className?: string) {
	return h.span.class('axis-placeholder', className).attr('aria-hidden', 'true')
}
