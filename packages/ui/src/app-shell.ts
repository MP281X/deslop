import type {View} from '@effect/ui'
import type {Html} from '@effect/ui/html'

import {Glass} from './glass.ts'

export function AppShell<M>(
	h: Html.H<M>,
	options: {sidebar: View.Input<M>; actions?: View.Input<M>; content: View.Input<M>}
) {
	return h.div
		.class('app-shell')
		.children(
			h.div
				.class('shell-controls')
				.children(
					options.sidebar,
					options.actions !== undefined && Glass(h, 'shell-actions').children(options.actions)
				),
			options.content
		)
}
