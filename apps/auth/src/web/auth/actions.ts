import {Array} from 'effect'

import {Button} from '@deslop/ui/control'

import type {Account, SignedAccount} from '#contracts'

import {Message} from '#web/auth/model.ts'
import type {H, Model} from '#web/auth/model.ts'

function ActionIcon(h: H, path: string) {
	return h.el('svg').attrs({'aria-hidden': 'true', viewBox: '0 0 24 24'}).children(h.el('path').attr('d', path))
}

export function SignOut(h: H, account: SignedAccount) {
	if (!account.signOut) return undefined
	return h.form
		.attrs({action: '/sign-out', method: 'post'})
		.children(
			Button(h, {type: 'submit'})
				.attrs({'aria-label': 'Sign out', title: 'Sign out'})
				.children(ActionIcon(h, 'M10 17l5-5-5-5m5 5H3m9-8h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-7'))
		)
}

export function PersonActions(h: H, person: Account, viewer: SignedAccount, admission: Model['admission']) {
	if (person.id === viewer.id) return SignOut(h, viewer)
	if (person.role !== 'Waiting') return undefined
	return Array.map(
		[
			{allow: false, label: 'Deny', path: 'M6 6l12 12M18 6L6 18'},
			{allow: true, label: 'Approve', path: 'M5 12l4 4L19 6'}
		],
		action =>
			Button(h, {disabled: admission?.pending ?? false})
				.attrs({'aria-label': `${action.label} @${person.name}`, title: action.label})
				.on('click', () => Message.Answer({allow: action.allow, id: person.id}))
				.children(ActionIcon(h, action.path))
	)
}
