import type {ShellAction} from '@deslop/ui/app-shell'

import type {Account} from '#contracts'

import {Message} from '#web/auth/model.ts'
import type {Model} from '#web/auth/model.ts'

export function SignOutControl(pending: boolean): ShellAction<Message> {
	return {
		disabled: pending,
		id: 'sign-out',
		message: Message.EndSession(),
		symbol: 'rectangle.portrait.and.arrow.right',
		title: 'Sign out'
	}
}

export function PersonActions(person: Account, admission: Model['admission']): readonly ShellAction<Message>[] {
	if (person.role !== 'Waiting') return []
	const disabled = admission?.pending ?? false
	return [
		{
			disabled,
			id: 'deny',
			message: Message.Answer({allow: false, id: person.id}),
			symbol: 'xmark',
			title: `Deny @${person.name}`
		},
		{
			disabled,
			id: 'approve',
			message: Message.Answer({allow: true, id: person.id}),
			symbol: 'checkmark',
			title: `Approve @${person.name}`
		}
	]
}
