import {OctagonAlert} from 'lucide-react'

import {GitHubIcon} from '#components/icons.tsx'
import {Alert, AlertDescription, AlertTitle} from '#components/ui/alert.tsx'
import {Button, buttonVariants} from '#components/ui/button.tsx'
import {Empty, EmptyContent, EmptyHeader, EmptyTitle} from '#components/ui/empty.tsx'
import {Spinner} from '#components/ui/spinner.tsx'
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

export function Loading() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner />
		</div>
	)
}

// A signed-out visitor's one way in; `href` is the app's sign-in link, which returns here.
export function SignIn(props: {href: string}) {
	return (
		<Empty>
			<EmptyContent>
				<a className={buttonVariants({size: 'lg'})} href={props.href}>
					<GitHubIcon />
					Sign in with GitHub
				</a>
			</EmptyContent>
		</Empty>
	)
}

export function Error(props: {error: unknown; reset: () => void}) {
	const message = formatError(props.error)

	return (
		<div className="flex flex-1 flex-col items-center justify-center gap-4 p-4">
			<Alert variant="destructive" className="w-full max-w-lg select-text">
				<OctagonAlert />
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
