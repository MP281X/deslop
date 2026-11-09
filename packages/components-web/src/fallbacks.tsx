import {ArrowClockwiseIcon, HouseIcon, LockIcon} from '@phosphor-icons/react'
import {useEffect} from 'react'
import type {ReactNode} from 'react'

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

// Apps have no sign-in screen of their own: a signed-out visitor goes straight to Auth, which returns here.
export function SignIn(props: {href: string}) {
	useEffect(() => {
		location.replace(props.href)
	}, [props.href])
	return null
}

// A denial keeps nothing on screen: the lock says it, and there is nothing to retry.
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
