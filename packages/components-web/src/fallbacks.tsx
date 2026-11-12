import {useAtomMount, useAtomRefresh, useAtomSuspense} from '@effect/atom-react'

import {Cause, Effect, Option} from 'effect'

import {ArrowClockwiseIcon, HouseIcon, LockIcon} from '@phosphor-icons/react'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {blockingFailure} from '@deslop/runtime/client/live-stream'
import {isDenied, needsSignIn, signInUrl} from '@deslop/runtime/shared/auth'

import {Button} from '#components/ui/button.tsx'
import {Empty, EmptyMedia} from '#components/ui/empty.tsx'

// Every state is one centred thing: the symbol alone, or the one action that fills the space. The label is for assistive technology.
export function EmptyState(props: {action?: ReactNode; icon: ReactNode; label: string}) {
	return (
		<Empty role="status" aria-label={props.label}>
			{props.action ?? (
				<EmptyMedia aria-hidden variant="symbol">
					{props.icon}
				</EmptyMedia>
			)}
		</Empty>
	)
}

export function NotFound() {
	return (
		<Empty aria-label="Page not found">
			<Button variant="outline" size="sm" render={<a href="/" aria-label="Home" />} nativeButton={false}>
				<HouseIcon />
				Home
			</Button>
		</Empty>
	)
}

// Mounted, the page leaves for the sign-in; a page that unmounts it first never goes.
const signInAtom = Atom.family((href: string) => Atom.make(Effect.sync(() => location.replace(href))))

function SignInRedirect(props: {href: string}) {
	useAtomMount(signInAtom(props.href))
	return null
}

// fallow-ignore-next-line unused-export -- a denial is only the lock, with nothing to retry; the tests render it directly.
export function AccessDenied() {
	return <EmptyState label="Access denied" icon={<LockIcon weight="light" />} />
}

// A failure names itself on the one button that retries it.
export function FailureRetry(props: {label?: string; reset: () => void}) {
	return (
		<Empty role="alert">
			<Button variant="destructive" size="sm" onClick={props.reset}>
				<ArrowClockwiseIcon />
				{props.label ?? 'Can’t load this view'}
			</Button>
		</Empty>
	)
}

// Every failed read: sign in without a session, a lock on a refusal, otherwise the one destructive retry.
export function ReadFailure(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignInRedirect href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <AccessDenied />
	return <FailureRetry reset={props.reset} />
}

// One gate for a read's content: a refusal, or a failure with nothing kept, is the ReadFailure; otherwise the value renders where it stands.
export function Loaded<A, E>(props: {
	atom: Atom.Atom<AsyncResult.AsyncResult<A, E>>
	children: (value: A) => ReactNode
}) {
	const result = useAtomSuspense(props.atom, {includeFailure: true})
	const refresh = useAtomRefresh(props.atom)
	return Option.match(blockingFailure(result), {
		onNone: () => Option.match(AsyncResult.value(result), {onNone: () => null, onSome: props.children}),
		onSome: cause => <ReadFailure error={Cause.squash(cause)} reset={refresh} />
	})
}
