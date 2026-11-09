import {HouseIcon, QuestionIcon, WarningCircleIcon} from '@phosphor-icons/react'
import {useEffect} from 'react'
import type {ReactNode} from 'react'

import {Button} from '#components/ui/button.tsx'

export function EmptyState(props: {action?: ReactNode; description?: string; icon: ReactNode; label: string}) {
	// A pane with nothing selected keeps the icon alone; a first-run or blocked list gives its ledger strip, a sentence and one action.
	if (props.action === undefined && props.description === undefined) {
		return (
			<div
				role="status"
				aria-label={props.label}
				className="text-muted-foreground flex min-h-32 flex-1 flex-col items-center justify-center"
			>
				{props.icon}
			</div>
		)
	}
	return (
		<div role="status" aria-label={props.label} className="border-border bg-card flex flex-col border">
			<div className="bg-strip text-strip-foreground flex min-h-7 items-center gap-2 px-3">
				<span className="text-primary shrink-0">{props.icon}</span>
				<span className="terminal-label">[{props.label}]</span>
			</div>
			<div className="flex flex-col items-start gap-3 p-4">
				{props.description !== undefined && (
					<p className="text-muted-foreground max-w-prose font-mono text-xs leading-relaxed">{props.description}</p>
				)}
				{props.action !== undefined && <div className="flex items-center gap-2">{props.action}</div>}
			</div>
		</div>
	)
}

export function NotFound() {
	return (
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<div className="w-full max-w-md">
				<EmptyState
					label="Page not found"
					description="The link is old, or it never existed."
					icon={<QuestionIcon className="size-5" weight="light" />}
					action={
						<Button variant="outline" render={<a href="/" aria-label="Go home" />}>
							<HouseIcon />
							Go home
						</Button>
					}
				/>
			</div>
		</div>
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
		<div className="flex min-h-0 flex-1 items-center justify-center p-6">
			<div role="alert" aria-label={props.label ?? 'Unavailable'} className="border-destructive w-full max-w-md border">
				<div className="bg-destructive text-background flex min-h-7 items-center gap-2 px-3">
					<WarningCircleIcon className="size-3.5 shrink-0" />
					<span className="terminal-label">{props.label ?? 'Can’t load this view'}</span>
				</div>
				<div className="flex flex-col items-start gap-3 p-4">
					<p className="text-muted-foreground font-mono text-xs leading-relaxed">
						The server did not answer. Nothing was lost; try the same view again.
					</p>
					<Button variant="destructive" size="sm" className="max-sm:h-11" onClick={props.reset}>
						Retry
					</Button>
				</div>
			</div>
		</div>
	)
}
