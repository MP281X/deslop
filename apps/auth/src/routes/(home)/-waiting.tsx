import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, DateTime, Duration, Match, Option, pipe} from 'effect'

import {ArrowRightIcon, HourglassIcon, KeyIcon} from '@phosphor-icons/react'
import {getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import {toQR} from 'toqr'

import {CopyButton} from '@deslop/components-web/copy-button'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {GitHubIcon} from '@deslop/components-web/icons'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {timerOf} from '@deslop/runtime/shared/format'

import {
	approveLink,
	passkeySignInAtom,
	requestAtom,
	requestCode,
	secondAtom,
	signInAtom,
	signInLabel
} from '#lib/auth.ts'
import {SignInList, SignInRowsSkeleton} from '#lib/components.tsx'
import {Failures} from '#routes/(home)/-sign-in.tsx'
import type {SignedAccount} from '#services/people/schema.ts'
import type {PendingAuthorization, SignInCode} from '#services/sign-ins/schema.ts'

const route = getRouteApi('/(home)')

// The link as a QR code, one square per dark module, inside the quiet zone scanners need.
function QrCode(props: {className?: string; text: string}) {
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

// Its own component, so only the time re-renders each second; only the last minute carries the warning dot.
function Countdown(props: {expiresAt: DateTime.Utc}) {
	const now = useAtomSuspense(secondAtom).value
	return (
		<span role="timer" className="text-muted-foreground flex items-center gap-1.5 text-xs">
			{DateTime.isLessThan(props.expiresAt, DateTime.addDuration(now, Duration.minutes(1))) && (
				<StatusDot status="warning" />
			)}
			<span>
				<span className="font-mono tabular-nums">{timerOf(DateTime.distance(now, props.expiresAt))}</span> left
			</span>
		</span>
	)
}

function CodeCard(props: {request: PendingAuthorization}) {
	const next = route.useSearch({select: search => search.next})
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [passkey, startPasskey] = useAtom(passkeySignInAtom)
	return (
		<Card className="m-auto w-full" aria-labelledby="waiting-title">
			<div className="flex flex-col gap-5 px-4">
				<h1 id="waiting-title" className="font-heading text-3xl leading-none tracking-tight">
					{signInLabel(props.request.clientName, props.request.device)}
				</h1>
				<div className="flex items-start gap-5">
					{/* The theme's own colours, so the dark theme shows light modules on a dark tile. */}
					<span className="bg-background text-foreground shrink-0 border p-2">
						<QrCode text={approveLink(props.request.id)} className="size-32" />
					</span>
					<div className="flex min-w-0 flex-col gap-2">
						<CopyButton label={`Copy the code ${requestCode(props.request.id)}`} value={requestCode(props.request.id)}>
							{requestCode(props.request.id)}
						</CopyButton>
						<Countdown expiresAt={props.request.expiresAt} />
					</div>
				</div>
				{/* Signing this browser in turns the page into the approver's, where the sign-in waits to be approved. */}
				{props.request.kind === 'App' && (
					<div className="flex flex-col gap-2 border-t pt-4">
						<Button
							variant="outline"
							size="sm"
							className="w-full max-sm:h-11"
							disabled={AsyncResult.isWaiting(passkey)}
							onClick={() => startPasskey(next)}
						>
							<KeyIcon />
							Approve here with a passkey
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="w-full max-sm:h-11"
							disabled={AsyncResult.isWaiting(signIn)}
							onClick={() => startSignIn()}
						>
							<GitHubIcon />
							Approve here with GitHub
						</Button>
					</div>
				)}
				<Failures />
			</div>
		</Card>
	)
}

// This browser started the sign-in, so a signed-in account answers it here without a code.
export function Waiting(props: {account: Option.Option<SignedAccount>; id: SignInCode}) {
	return pipe(
		useAtomSuspense(requestAtom(props.id)).value,
		Match.value,
		Match.tagsExhaustive({
			Decided: () => <EmptyState label="Continuing" icon={<ArrowRightIcon weight="light" />} />,
			// The link stays expired on every reload, so the way out drops it: Auth's own sign-in, or its sign-ins when signed in.
			Expired: () => (
				<EmptyState
					label="This sign-in expired"
					icon={<HourglassIcon className="size-5" weight="light" />}
					action={
						<Button variant="outline" onClick={() => location.assign('/')}>
							Back to Auth
						</Button>
					}
				/>
			),
			Waiting: value =>
				pipe(
					props.account,
					Option.filter(signed => signed.role !== 'Waiting'),
					Option.match({
						onNone: () => <CodeCard request={value.request} />,
						onSome: () => (
							<Suspense fallback={<SignInRowsSkeleton pending />}>
								<SignInList pending={Option.some(value.request)} />
							</Suspense>
						)
					})
				)
		})
	)
}
