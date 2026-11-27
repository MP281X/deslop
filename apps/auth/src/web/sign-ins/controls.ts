import {Boolean, Function} from 'effect'

import {ActionShell} from '@deslop/ui/app-shell'
import {Notice} from '@deslop/ui/axis'
import {Button} from '@deslop/ui/control'
import {Glass} from '@deslop/ui/glass'

import {Message} from '#web/auth/model.ts'
import type {H, Model} from '#web/auth/model.ts'
import {ReadProblem} from '#web/auth/reading.ts'
import github from '#web/sign-ins/github.svg'

export function NativeSignIn(h: H, model: Model, canSignIn: boolean) {
	return ActionShell(h, {
		actions: Boolean.match(canSignIn, {
			onFalse: () => [],
			onTrue: () => [
				{
					disabled: model.signIn === 'pending',
					id: 'sign-in',
					message: Message.StartSignIn(),
					symbol: 'rectangle.portrait.and.arrow.right',
					title: 'Continue with GitHub'
				} as const
			]
		}),
		content: h.section
			.class('auth-screen auth-waiting')
			.attr('aria-label', 'Sign-ins')
			.children(
				canSignIn &&
					Notice(
						h,
						Boolean.match(model.signIn === 'failed', {
							onFalse: Function.constant('Sign in to Auth'),
							onTrue: Function.constant('Couldn’t sign in')
						})
					),
				ReadProblem(h, model.account, 'account')
			)
	})
}

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
