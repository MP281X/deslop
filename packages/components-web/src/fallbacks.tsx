import {OctagonAlert} from 'lucide-react'

import {Alert, AlertDescription, AlertTitle} from '#components/ui/alert.tsx'
import {Button} from '#components/ui/button.tsx'
import {Spinner} from '#components/ui/spinner.tsx'
import {formatError} from '#lib/utils.ts'

export function NotFound() {
	return (
		<div className="flex flex-1 items-center justify-center p-4">
			<Alert variant="destructive" className="w-full max-w-lg">
				<OctagonAlert />
				<AlertTitle>Page not found</AlertTitle>
				<AlertDescription>Error 404</AlertDescription>
			</Alert>
		</div>
	)
}

export function Loading() {
	return (
		<div className="flex flex-1 items-center justify-center">
			<Spinner />
		</div>
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
