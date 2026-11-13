import {ArrowClockwiseIcon, HouseIcon, LockIcon} from '@phosphor-icons/react'
import {useEffect} from 'react'
import type {ReactNode} from 'react'

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

// fallow-ignore-next-line unused-export -- the app template, which Fallow skips, sends a signed-out visitor straight to Auth with it.
export function SignIn(props: {href: string}) {
	useEffect(() => {
		location.replace(props.href)
	}, [props.href])
	return null
}

// fallow-ignore-next-line unused-export -- a denial is only the lock, with nothing to retry; the tests render it directly.
export function Denied() {
	return <EmptyState label="Access denied" icon={<LockIcon weight="light" />} />
}

// A failure names itself on the one button that retries it.
export function Error(props: {error: unknown; label?: string; reset: () => void}) {
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
export function Failure(props: {error: unknown; reset: () => void}) {
	if (needsSignIn(props.error)) return <SignIn href={signInUrl(location.href)} />
	if (isDenied(props.error)) return <Denied />
	return <Error error={props.error} reset={props.reset} />
}
