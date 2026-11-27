import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'

import {Message} from '#web/auth/model.ts'
import type {H} from '#web/auth/model.ts'
import github from '#web/sign-ins/github.svg'

export function SignIn(h: H, error?: string) {
	return h.section
		.class('auth-center')
		.attr('aria-label', 'Sign in')
		.children(
			Glass(h).children(
				Button(h)
					.class('auth-action')
					.on('click', () => Message.StartSignIn())
					.children(h.img.attr('src', github).attr('alt', ''), 'Continue with GitHub')
			),
			error !== undefined &&
				h.p
					.class('axis-muted text-wrap')
					.attr('role', 'alert')
					.children(h.span.class('axis-dot').attr('aria-hidden', 'true'), error)
		)
}
