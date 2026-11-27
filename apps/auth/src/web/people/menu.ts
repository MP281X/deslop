import {Array} from 'effect'

import type {ShellAction, ShellMenuItem} from '@deslop/ui/app-shell'
import {Button} from '@deslop/ui/control'
import {GlassPanel} from '@deslop/ui/glass'
import {SymbolIcon} from '@deslop/ui/symbol'

import {Message} from '#web/auth/model.ts'
import type {H, Model} from '#web/auth/model.ts'

export function peopleMenu(state: Model) {
	const items = [
		{checked: !state.waitingOnly, id: 'all', message: Message.FilterPeople({waitingOnly: false}), title: 'All people'},
		{
			checked: state.waitingOnly,
			id: 'waiting',
			message: Message.FilterPeople({waitingOnly: true}),
			title: 'Waiting for approval'
		}
	] satisfies readonly ShellMenuItem<Message>[]
	return {
		id: 'people',
		menu: [{items, title: ''}] as const,
		message: Message.PeopleMenu({open: !state.peopleMenuOpen}),
		symbol: 'line.3.horizontal.decrease',
		title: 'People options'
	} satisfies ShellAction<Message>
}

export function PeopleMenu(h: H, state: Model, action: ReturnType<typeof peopleMenu>) {
	return GlassPanel(
		h,
		'auth-people-options',
		action.title,
		Array.map(action.menu[0].items, item =>
			Button(h)
				.key(item.id)
				.attrs({'aria-checked': `${item.checked}`, role: 'menuitemradio'})
				.on('click', item.message)
				.children(item.title, item.checked && SymbolIcon(h, 'checkmark'))
		)
	)
		.attr('role', 'menu')
		.popover('auto', state.peopleMenuOpen)
		.on('toggle', event => {
			if (!event.open) return Message.PeopleMenu({open: false})
			return undefined
		})
}
