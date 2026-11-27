import {Command} from '@effect/ui'
import {Html, HtmlCommand} from '@effect/ui/html'

import {Button} from './control.ts'
import {SymbolIcon} from './symbol.ts'

const SignOutForm = Html.ref('SignOutForm', 'form')

export function WebSignOut<M>(h: Html.H<M>, options: {toolbar?: boolean; icon?: boolean} = {}) {
	const form = h.form.attrs({action: `/auth/sign-out?${new URLSearchParams({next: location.href})}`, method: 'post'})
	if (options.toolbar === true) return form.ref(SignOutForm).attr('hidden', '')
	return form.children(
		Button(h, {type: 'submit'})
			.attr('role', 'menuitem')
			.children('Sign out', options.icon === true && SymbolIcon(h, 'rectangle.portrait.and.arrow.right'))
	)
}

export const submitWebSignOut = Command.asNoop(HtmlCommand.RequestSubmit.make({ref: SignOutForm}))
