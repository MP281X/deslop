import {HouseIcon, QuestionIcon, WarningCircleIcon} from '@phosphor-icons/react'
import {useEffect} from 'react'
import type {ReactNode} from 'react'

import {Alert, AlertAction, AlertDescription, AlertTitle} from '#components/ui/alert.tsx'
import {Button} from '#components/ui/button.tsx'
import {Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia} from '#components/ui/empty.tsx'

export function EmptyState(props: {action?: ReactNode; description?: string; icon: ReactNode; label: string}) {
	if (props.action === undefined && props.description === undefined) {
		return (
			<Empty role="status" aria-label={props.label}>
				<EmptyMedia variant="icon">{props.icon}</EmptyMedia>
			</Empty>
		)
	}
	return (
		<Empty role="status" aria-label={props.label}>
			<EmptyHeader>
				<EmptyMedia variant="icon" className="mb-3">
					{props.icon}
				</EmptyMedia>
				<h2 className="font-heading text-2xl leading-none tracking-tight">{props.label}</h2>
				{props.description !== undefined && <EmptyDescription>{props.description}</EmptyDescription>}
			</EmptyHeader>
			{props.action !== undefined && <EmptyContent>{props.action}</EmptyContent>}
		</Empty>
	)
}

export function NotFound() {
	return (
		<Empty aria-label="Page not found">
			<EmptyHeader>
				<EmptyMedia variant="icon">
					<QuestionIcon className="size-5" weight="light" />
				</EmptyMedia>
				<h2 className="font-heading text-2xl leading-none tracking-tight">Page not found</h2>
				<EmptyDescription>The link is old, or it never existed.</EmptyDescription>
			</EmptyHeader>
			<EmptyContent>
				<Button variant="outline" render={<a href="/" aria-label="Go home" />}>
					<HouseIcon />
					Go home
				</Button>
			</EmptyContent>
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

export function Error(props: {error: unknown; label?: string; reset: () => void}) {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<Alert variant="destructive" role="alert" aria-label={props.label ?? 'Unavailable'} className="max-w-md">
				<WarningCircleIcon />
				<AlertTitle>{props.label ?? 'Can’t load this view'}</AlertTitle>
				<AlertDescription>The server did not answer. Nothing was lost; try the same view again.</AlertDescription>
				<AlertAction>
					<Button variant="destructive" size="sm" className="max-sm:h-11" onClick={props.reset}>
						Retry
					</Button>
				</AlertAction>
			</Alert>
		</div>
	)
}
