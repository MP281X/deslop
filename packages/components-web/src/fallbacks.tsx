import {WarningOctagonIcon} from '@phosphor-icons/react'
import {useEffect} from 'react'

import {Alert, AlertDescription, AlertTitle} from '#components/ui/alert.tsx'
import {Button, buttonVariants} from '#components/ui/button.tsx'
import {Empty, EmptyContent, EmptyHeader, EmptyTitle} from '#components/ui/empty.tsx'
import {formatError} from '#lib/utils.ts'

export function NotFound() {
	return (
		<Empty>
			<EmptyHeader>
				<EmptyTitle>Page not found</EmptyTitle>
			</EmptyHeader>
			<EmptyContent>
				<a className={buttonVariants({variant: 'outline'})} href="/">
					Go home
				</a>
			</EmptyContent>
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

export function Error(props: {error: unknown; reset: () => void}) {
	const message = formatError(props.error)

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
			<Alert variant="destructive" className="w-full max-w-lg select-text">
				<WarningOctagonIcon />
				<AlertTitle>Something went wrong</AlertTitle>
				<AlertDescription className="wrap-break-word whitespace-pre-wrap">{message}</AlertDescription>
			</Alert>
			<div className="flex gap-2">
				<Button
					variant="ghost"
					onClick={async () => {
						await navigator.clipboard.writeText(message)
					}}
				>
					Copy error
				</Button>
				<Button onClick={props.reset}>Try again</Button>
			</div>
		</div>
	)
}
