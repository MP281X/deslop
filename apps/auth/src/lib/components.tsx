import {useAtom} from '@effect/atom-react'

import {Array, Option, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {toQR} from 'toqr'

import {Button} from '@deslop/components-web/ui/button'

import {appNames, avatarUrl, consentAtom, requestCode, timeLabel} from '#lib/utils.ts'
import type {PendingAuthorization} from '#services/authorizations/schema.ts'

// The link as a QR code, one square per dark module, inside the quiet zone scanners need.
export function QrCode(props: {className?: string; text: string}) {
	const modules = Array.fromIterable(toQR(props.text))
	const size = Math.sqrt(modules.length)
	return (
		<svg
			viewBox={`-2 -2 ${size + 4} ${size + 4}`}
			shapeRendering="crispEdges"
			fill="currentColor"
			className={props.className}
			aria-hidden="true"
		>
			<path
				d={pipe(
					modules,
					Array.map((dark, index) => ({dark, x: index % size, y: Math.floor(index / size)})),
					Array.filter(module => module.dark === 1),
					Array.map(module => `M${module.x} ${module.y}h1v1h-1z`),
					Array.join('')
				)}
			/>
		</svg>
	)
}

// Lucide has no brand icons; this is GitHub's mark from its Octicons.
export function GitHubIcon(props: {className?: string}) {
	return (
		<svg viewBox="0 0 16 16" fill="currentColor" className={props.className} aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	)
}

export function Avatar(props: {id: string; name: string}) {
	return <img src={avatarUrl(props.id)} alt={props.name} className="bg-muted size-6 shrink-0" />
}

// A waiting sign-in: which client and the apps it reaches, answered here; a failed answer stays to retry.
export function Review(props: {request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	return (
		<section className="flex flex-col gap-2" aria-label="Sign-in request">
			<h2 className="text-muted-foreground text-xs tracking-wider uppercase tabular-nums">
				Sign-in request · {requestCode(props.request.id)}
			</h2>
			<p className="truncate text-sm">{props.request.clientName}</p>
			<ul className="flex flex-wrap gap-1" aria-label="Apps">
				{Array.map(appNames(props.request.resources), app => (
					<li key={app} className="bg-secondary px-2.5 py-1.5 text-xs">
						{app}
					</li>
				))}
			</ul>
			<p className="text-muted-foreground text-xs tabular-nums">until {timeLabel(props.request.expiresAt)}</p>
			{Option.match(AsyncResult.error(consent), {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-xs" role="alert">
						{failure.message}
					</p>
				)
			})}
			<div className="mt-2 grid grid-cols-2 gap-1.5 text-xs">
				<Button
					size="lg"
					disabled={AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: true, request: props.request})}
				>
					Approve
				</Button>
				<Button
					size="lg"
					variant="secondary"
					disabled={AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: false, request: props.request})}
				>
					Deny
				</Button>
			</div>
		</section>
	)
}
