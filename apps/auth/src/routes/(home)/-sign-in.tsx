import {useAtom} from '@effect/atom-react'

import {Function, Option, Schema, pipe} from 'effect'

import {KeyIcon} from '@phosphor-icons/react'
import {getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'

import {GitHubIcon} from '@deslop/components-web/icons'
import {Button} from '@deslop/components-web/ui/button'
import {FieldError} from '@deslop/components-web/ui/field'

import {codeSignInAtom, passkeySignInAtom, signInAtom} from '#lib/auth.ts'

const route = getRouteApi('/(home)')

export type SignInVerb = typeof SignInVerb.Type
const SignInVerb = Schema.Literals(['Approve here', 'Continue'])

export function Failures() {
	const failed = route.useSearch({select: search => Option.isSome(search.error)})
	const [signIn] = useAtom(signInAtom)
	const [codeSignIn] = useAtom(codeSignInAtom)
	const [passkey] = useAtom(passkeySignInAtom)
	return (
		<>
			{Option.match(
				pipe(
					AsyncResult.error(signIn),
					Option.orElse(() => AsyncResult.error(codeSignIn)),
					Option.orElse(() => AsyncResult.error(passkey))
				),
				{onNone: Function.constNull, onSome: failure => <FieldError>{failure.message}</FieldError>}
			)}
			{failed && <FieldError>GitHub sign-in failed. Try again.</FieldError>}
		</>
	)
}

// The two ways to sign this browser in, worded for the page: continuing to Auth, or approving a waiting sign-in here.
export function Providers(props: {verb: SignInVerb}) {
	const next = route.useSearch({select: search => search.next})
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [passkey, startPasskey] = useAtom(passkeySignInAtom)
	return (
		<>
			<Button size="lg" className="w-full" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
				<GitHubIcon />
				{props.verb} with GitHub
			</Button>
			<Button
				size="lg"
				variant="outline"
				className="w-full"
				disabled={AsyncResult.isWaiting(passkey)}
				onClick={() => startPasskey(next)}
			>
				<KeyIcon />
				{props.verb} with a passkey
			</Button>
		</>
	)
}

export function SignIn() {
	const next = route.useSearch({select: search => search.next})
	const [codeSignIn, startCodeSignIn] = useAtom(codeSignInAtom)
	return (
		<section
			className="m-auto flex w-full -translate-y-2 flex-col gap-5 sm:max-w-80 lg:-translate-y-3"
			aria-label="Sign in"
		>
			<h1 className="sr-only">Sign in</h1>
			<div className="flex flex-col gap-2">
				<Providers verb="Continue" />
				<Button
					size="lg"
					variant="ghost"
					className="w-full"
					disabled={AsyncResult.isWaiting(codeSignIn)}
					onClick={() => startCodeSignIn(next)}
				>
					Use a sign-in code
				</Button>
				<Failures />
			</div>
		</section>
	)
}
