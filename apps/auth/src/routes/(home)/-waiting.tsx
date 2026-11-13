import {useAtomSuspense} from '@effect/atom-react'

import {Array, DateTime, Duration, Match, Option, pipe} from 'effect'

import {ArrowRightIcon, HourglassIcon} from '@phosphor-icons/react'
import {Suspense} from 'react'
import {toQR} from 'toqr'

import {CopyButton} from '@deslop/components-web/copy-button'
import {EmptyState} from '@deslop/components-web/fallbacks'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {timerOf} from '@deslop/runtime/shared/format'

import {approveLink, requestAtom, requestCode, secondAtom, signInLabel} from '#lib/auth.ts'
import {RequestMark, SignInList, SignInRowsSkeleton} from '#lib/components.tsx'
import {Failures, Providers} from '#routes/(home)/-sign-in.tsx'
import type {SignedAccount} from '#services/people/schema.ts'
import type {PendingAuthorization, SignInCode} from '#services/sign-ins/schema.ts'

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

// The sign-in page's column and buttons, under one line naming who asks and for how long; another device's way in closes it.
function Request(props: {request: PendingAuthorization}) {
	const code = requestCode(props.request.id)
	return (
		<section
			className="m-auto flex w-full -translate-y-2 flex-col gap-5 sm:max-w-80 lg:-translate-y-3"
			aria-label="Sign-in request"
		>
			<h1 className="sr-only">Approve a sign-in</h1>
			<div className="flex items-center gap-2 text-sm">
				<span className="flex size-4 shrink-0 items-center justify-center [&_svg]:size-4">
					<RequestMark request={props.request} />
				</span>
				<p className="min-w-0 flex-1 truncate">{signInLabel(props.request.clientName, props.request.device)}</p>
				<Countdown expiresAt={props.request.expiresAt} />
			</div>
			{/* Signing this browser in turns the page into the approver's, where the sign-in waits to be approved. */}
			{props.request.kind === 'App' && (
				<div className="flex flex-col gap-2">
					<Providers verb="Approve here" />
				</div>
			)}
			<Failures />
			<div className="flex items-center gap-4 border-t pt-5">
				{/* The theme's own colours, so the dark theme shows light modules on a dark tile. */}
				<span className="bg-background text-foreground shrink-0 border p-1.5">
					<QrCode text={approveLink(props.request.id)} className="size-24 sm:size-28" />
				</span>
				<div className="flex min-w-0 flex-col items-start gap-1">
					<p className="text-muted-foreground text-xs/relaxed">On a device signed in to Auth, scan this or enter</p>
					<CopyButton
						label={`Copy the code ${code}`}
						value={code}
						className="-ml-2.5"
						failure="Cannot copy the code; type it in instead"
					>
						{code}
					</CopyButton>
				</div>
			</div>
		</section>
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
						onNone: () => <Request request={value.request} />,
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
