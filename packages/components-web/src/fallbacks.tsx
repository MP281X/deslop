import {HouseIcon, QuestionIcon, WarningCircleIcon} from '@phosphor-icons/react'
import {useEffect} from 'react'
import type {ReactNode} from 'react'

import {Button, buttonVariants} from '#components/ui/button.tsx'
import {Empty} from '#components/ui/empty.tsx'

export function EmptyState(props: {icon: ReactNode; label: string}) {
	return (
		<Empty role="status" aria-label={props.label}>
			<span aria-hidden className="text-muted-foreground/40 flex items-center justify-center">
				{props.icon}
			</span>
		</Empty>
	)
}

export function NotFound() {
	return (
		<Empty aria-label="Page not found">
			<QuestionIcon weight="light" className="text-muted-foreground/40 size-6" />
			<a className={buttonVariants({size: 'icon', variant: 'ghost'})} href="/" aria-label="Go home" title="Go home">
				<HouseIcon className="size-4" />
			</a>
		</Empty>
	)
}

// A signed-out visitor goes straight to Auth through `href`, the app's sign-in link, which returns here; apps have no sign-in screen of their own.
export function SignIn(props: {href: string}) {
	useEffect(() => {
		location.replace(props.href)
	}, [props.href])
	return null
}

export function Error(props: {error: unknown; label?: string; reset: () => void}) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-3">
			<div role="alert" aria-label={props.label ?? 'Unavailable'} className="flex flex-col items-center gap-2">
				<p className="flex items-center gap-2">
					<WarningCircleIcon aria-hidden className="text-destructive size-4 shrink-0" />
					<span>{props.label ?? 'Can’t load this view.'}</span>
				</p>
				<Button variant="destructive" className="max-sm:h-11" onClick={props.reset}>
					Retry
				</Button>
			</div>
		</div>
	)
}
