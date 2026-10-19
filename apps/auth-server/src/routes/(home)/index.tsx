import {useAtom, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, DateTime, Option, Record} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {LoaderCircle, LogOut} from 'lucide-react'
import {Suspense} from 'react'

import type {PendingAuthorization} from '@deslop/auth/schema'
import {AuthorizationStatus} from '@deslop/auth/schema'
import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'

import {
	applicationName,
	connectedAtom,
	consentAtom,
	meAtom,
	pendingAtom,
	requestAtom,
	requestCode,
	requestId,
	signInAtom,
	signOutAtom,
	timeLabel
} from '#lib/utils.ts'

export const Route = createFileRoute('/(home)/')({component: Home})

// icon.png's 11×18 pixels as vectors, so its outline follows the theme instead of a white box.
function Logo() {
	return (
		<svg viewBox="3 0 11 18" shapeRendering="crispEdges" className="h-6 w-auto shrink-0" role="img" aria-label="Deslop">
			<path
				className="fill-primary"
				d="M12 0h1v1h-1zM11 1h1v1h-1zM10 2h2v1h-2zM9 3h2v1h-2zM8 4h3v1h-3zM7 5h3v1h-3zM6 6h4v1h-4zM5 7h4v1h-4zM4 8h5v1h-5zM3 9h10v1h-10zM8 10h4v1h-4zM7 11h4v1h-4zM7 12h3v1h-3zM6 13h3v1h-3zM6 14h2v1h-2zM5 15h2v1h-2zM5 16h1v1h-1zM4 17h1v1h-1z"
			/>
			<path
				className="fill-foreground"
				d="M13 0h1v1h-1zM3 1h1v1h-1zM7 1h1v1h-1zM12 1h1v1h-1zM6 2h1v1h-1zM12 2h1v1h-1zM5 3h1v1h-1zM11 3h1v1h-1zM4 4h1v1h-1zM11 4h1v1h-1zM10 5h1v1h-1zM10 6h1v1h-1zM9 7h1v1h-1zM9 8h1v1h-1zM13 9h1v1h-1zM12 10h1v1h-1zM11 11h1v1h-1zM10 12h1v1h-1zM9 13h1v1h-1zM8 14h1v1h-1zM12 14h1v1h-1zM7 15h1v1h-1zM11 15h1v1h-1zM6 16h1v1h-1zM10 16h1v1h-1zM5 17h1v1h-1zM13 17h1v1h-1z"
			/>
		</svg>
	)
}

// Lucide has no brand icons; this is GitHub's mark from its Octicons.
function GitHubIcon() {
	return (
		<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	)
}

function Home() {
	return (
		<Suspense fallback={<Loading />}>
			<HomeContent />
		</Suspense>
	)
}

function Waiting(props: {id: string}) {
	return AuthorizationStatus.match(useAtomSuspense(requestAtom(props.id)).value, {
		Completed: () => (
			<p className="text-muted-foreground text-sm" role="status">
				Returning to the app…
			</p>
		),
		Expired: () => (
			<p className="text-destructive text-sm" role="alert">
				This request expired. Start sign-in again in the app.
			</p>
		),
		Waiting: value => (
			<section className="flex flex-col gap-2 border-y py-3">
				<h2 className="text-sm font-medium">Waiting for approval · {requestCode(value.request.id)}</h2>
				<p className="text-muted-foreground text-sm">
					Approve {applicationName(value.request)} at {location.host} in your signed-in browser. You do not need to sign
					in here.
				</p>
			</section>
		)
	})
}

function RequestRow(props: {request: PendingAuthorization}) {
	const connected = useAtomValue(connectedAtom)
	const [consent, respond] = useAtom(consentAtom)
	return (
		<li className="flex flex-col gap-3 border-b py-3">
			<div className="flex flex-wrap items-baseline gap-x-2">
				<span className="text-sm font-medium">{props.request.clientName}</span>
				<span className="text-muted-foreground text-xs">claimed client</span>
				<time
					className="text-muted-foreground ml-auto text-xs"
					dateTime={DateTime.formatIso(DateTime.makeUnsafe(props.request.createdAt))}
				>
					{timeLabel(props.request.createdAt)}
				</time>
			</div>
			<dl className="text-sm">
				<div className="grid grid-cols-4 items-baseline gap-3 py-0.5">
					<dt className="text-muted-foreground text-xs">Request ID</dt>
					<dd className="col-span-3 min-w-0 tabular-nums">{requestCode(props.request.id)}</dd>
				</div>
				<div className="grid grid-cols-4 items-baseline gap-3 py-0.5">
					<dt className="text-muted-foreground text-xs">Returns to</dt>
					<dd className="col-span-3 min-w-0 break-all">{props.request.redirectUri}</dd>
				</div>
				<div className="grid grid-cols-4 items-baseline gap-3 py-0.5">
					<dt className="text-muted-foreground text-xs">Access</dt>
					<dd className="col-span-3 min-w-0 break-all">
						<ul>
							{Array.map(props.request.resources, resource => (
								<li key={resource}>{resource}</li>
							))}
						</ul>
					</dd>
				</div>
				<div className="grid grid-cols-4 items-baseline gap-3 py-0.5">
					<dt className="text-muted-foreground text-xs">Expires</dt>
					<dd className="col-span-3 min-w-0">
						<time dateTime={DateTime.formatIso(DateTime.makeUnsafe(props.request.expiresAt))}>
							{timeLabel(props.request.expiresAt)}
						</time>
					</dd>
				</div>
			</dl>
			<div className="grid grid-cols-2 gap-2">
				<Button
					size="lg"
					disabled={!connected || AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: true, request: props.request})}
				>
					Approve
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={!connected || AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: false, request: props.request})}
				>
					Deny
				</Button>
			</div>
		</li>
	)
}

function Inbox() {
	const requests = useAtomSuspense(pendingAtom).value
	const connected = useAtomValue(connectedAtom)
	const consent = useAtomValue(consentAtom)
	return (
		<section className="flex flex-col gap-6" aria-label="Pending requests">
			<div className="flex flex-col gap-1">
				<p className="text-muted-foreground text-xs">
					Approve only requests you started. Match the request ID in your thread.
				</p>
				<p className="text-muted-foreground text-xs" role="status">
					{Boolean.match(connected, {
						onFalse: () => 'Reconnecting · approvals paused until live updates return',
						onTrue: () => 'Live'
					})}
				</p>
				{AsyncResult.isSuccess(consent) && (
					<p className="text-muted-foreground text-xs" role="status">
						{Boolean.match(consent.value.accept, {onFalse: () => 'Denied', onTrue: () => 'Approved'})}{' '}
						{requestCode(consent.value.request.id)} · {applicationName(consent.value.request)}
					</p>
				)}
			</div>
			{Array.match(requests, {
				onEmpty: () => (
					<p className="text-muted-foreground text-sm" role="status">
						No pending requests
					</p>
				),
				onNonEmpty: pending =>
					Array.map(Record.toEntries(Array.groupBy(pending, applicationName)), entry => (
						<section key={entry[0]}>
							<h2 className="border-b pb-2 text-sm font-medium">{entry[0]}</h2>
							<ul>
								{Array.map(entry[1], request => (
									<RequestRow key={request.id} request={request} />
								))}
							</ul>
						</section>
					))
			})}
		</section>
	)
}

function HomeContent() {
	const user = useAtomSuspense(meAtom).value
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [signOut, endSession] = useAtom(signOutAtom)
	const consent = useAtomValue(consentAtom)
	const error = Option.orElse(AsyncResult.error(signIn), () =>
		Option.orElse(AsyncResult.error(consent), () => AsyncResult.error(signOut))
	)
	return (
		<main className="flex flex-1 justify-center overflow-y-auto px-6 py-10 md:py-24">
			<div className="flex w-full max-w-md flex-col gap-6">
				<div className="flex items-center gap-2.5">
					<Logo />
					<h1 className="text-xl font-semibold">Deslop Auth</h1>
				</div>
				{Option.match(requestId, {onNone: () => null, onSome: id => <Waiting id={id} />})}
				{Option.match(user, {
					onNone: () => (
						<Button size="lg" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
							{Boolean.match(AsyncResult.isWaiting(signIn), {
								onFalse: () => <GitHubIcon />,
								onTrue: () => <LoaderCircle className="motion-safe:animate-spin" />
							})}
							Sign in with GitHub
						</Button>
					),
					onSome: account => (
						<>
							<div className="flex items-center justify-between gap-2 border-y py-3">
								<p className="min-w-0 truncate text-sm">{account.name}</p>
								<Button
									variant="ghost"
									size="icon-lg"
									aria-label="Sign out"
									disabled={AsyncResult.isWaiting(signOut)}
									onClick={() => endSession()}
								>
									<LogOut />
								</Button>
							</div>
							<Inbox />
						</>
					)
				})}
				{Option.match(error, {
					onNone: () => null,
					onSome: failure => (
						<p className="text-destructive text-sm" role="alert">
							{failure.message}
						</p>
					)
				})}
				{new URLSearchParams(location.search).has('error') && (
					<p className="text-destructive text-sm" role="alert">
						Sign-in failed. Sign in with an allowed GitHub account.
					</p>
				)}
			</div>
		</main>
	)
}
