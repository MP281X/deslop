import {useAtom} from '@effect/atom-react'

import {Array, Option, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {toQR} from 'toqr'

import {Button} from '@deslop/components-web/ui/button'

import {applicationName, avatarUrl, consentAtom, timeLabel} from '#lib/utils.ts'
import type {Account, PendingAuthorization} from '#services/authorizations/schema.ts'

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

// An account's provider picture, with the provider's mark in its corner; GitHub is the only provider so far.
export function Avatar(props: {id: string; name: string}) {
	return (
		<span className="relative size-8 shrink-0">
			<img src={avatarUrl(props.id)} alt="" className="bg-muted size-8" />
			<span className="bg-background text-foreground absolute -right-1 -bottom-1 grid size-4 place-items-center">
				<GitHubIcon className="size-3" />
			</span>
			<span className="sr-only">{props.name} on GitHub</span>
		</span>
	)
}

// A waiting sign-in with the account it signs in as, answered here; a failed answer stays on the card to retry.
export function RequestCard(props: {account: Account; request: PendingAuthorization}) {
	const [consent, respond] = useAtom(consentAtom)
	function answer(accept: boolean) {
		respond({accept, request: props.request})
	}
	return (
		<div className="bg-card flex flex-col gap-3 p-4">
			<div className="flex items-start gap-3">
				<div className="flex min-w-0 grow flex-col">
					<span className="truncate text-sm font-medium">
						{Array.join(
							Array.dedupeWith([applicationName(props.request), props.request.clientName], (left, right) =>
								String.Equivalence(String.toLowerCase(left), String.toLowerCase(right))
							),
							' · '
						)}
					</span>
					<span className="text-muted-foreground truncate text-xs">{props.request.redirectUri}</span>
				</div>
				<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
					until {timeLabel(props.request.expiresAt)}
				</span>
			</div>
			<div className="text-muted-foreground flex items-center gap-2 text-xs">
				<Avatar id={props.account.id} name={props.account.name} />
				<span className="truncate">
					Signs in as <span className="text-foreground">{props.account.fullName ?? props.account.name}</span>
				</span>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<Button size="lg" disabled={AsyncResult.isWaiting(consent)} onClick={() => answer(true)}>
					Approve
				</Button>
				<Button size="lg" variant="secondary" disabled={AsyncResult.isWaiting(consent)} onClick={() => answer(false)}>
					Deny
				</Button>
			</div>
			{Option.match(AsyncResult.error(consent), {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-xs" role="alert">
						{failure.message}
					</p>
				)
			})}
		</div>
	)
}
