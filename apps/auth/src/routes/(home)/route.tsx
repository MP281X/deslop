import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, pipe} from 'effect'

import {Link, Outlet, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {LoaderCircle, LogOut} from 'lucide-react'
import {Suspense} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'

import {Avatar, GitHubIcon, QrCode, RequestCard} from '#lib/components.tsx'
import {
	accountAtom,
	applicationName,
	approveLink,
	peopleAtom,
	requestAtom,
	requestCode,
	requestId,
	signInAtom,
	signOutAtom
} from '#lib/utils.ts'
import type {Account, PendingAuthorization} from '#services/authorizations/schema.ts'

// icon.png's 11×18 pixels as vectors, so its outline follows the theme instead of a white box.
function Logo() {
	return (
		<svg viewBox="3 0 11 18" shapeRendering="crispEdges" className="h-5 w-auto shrink-0" role="img" aria-label="Deslop">
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

// A device that is not signed in: the QR opens the approve page with the code filled in on a phone that is.
function CodeCard(props: {request: PendingAuthorization}) {
	const [signIn, startSignIn] = useAtom(signInAtom)
	return (
		<section className="flex flex-col items-center gap-4 pt-4 text-center">
			<h2 className="text-muted-foreground text-xs tracking-wider uppercase">
				{applicationName(props.request)} wants to sign in
			</h2>
			<a href={approveLink(props.request.id)} aria-label="Approve this sign-in" className="border p-3">
				<QrCode text={approveLink(props.request.id)} className="size-36" />
			</a>
			<p className="text-2xl font-semibold tracking-widest tabular-nums">{requestCode(props.request.id)}</p>
			<p className="text-muted-foreground max-w-72 text-xs">
				Scan with a phone where you are signed in, or enter the code at{' '}
				<span className="text-foreground">{location.host}</span>.
			</p>
			<p className="text-muted-foreground flex items-center gap-2 text-xs" role="status">
				<span className="bg-primary size-2 motion-safe:animate-pulse" aria-hidden="true" />
				Waiting for approval
			</p>
			<Button variant="link" size="sm" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
				Sign in with GitHub on this device
			</Button>
		</section>
	)
}

// This browser started the sign-in, so a signed-in account answers it here without a code.
function Waiting(props: {account: Option.Option<Account>; id: string}) {
	return pipe(
		useAtomSuspense(requestAtom(props.id)).value,
		Match.value,
		Match.tagsExhaustive({
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
			Waiting: value =>
				Option.match(
					Option.filter(props.account, signed => signed.role !== 'Waiting'),
					{
						onNone: () => <CodeCard request={value.request} />,
						onSome: signed => <RequestCard account={signed} request={value.request} />
					}
				)
		})
	)
}

function Tabs() {
	return (
		<nav className="bg-card grid grid-cols-2 gap-1 p-1" aria-label="Sections">
			{Array.map(
				[
					{count: 0, label: 'Sign-ins', to: '/'},
					{
						count: Array.countBy(useAtomSuspense(peopleAtom).value, person => person.role === 'Waiting'),
						label: 'People',
						to: '/people'
					}
				] as const,
				tab => (
					<Link
						key={tab.to}
						to={tab.to}
						className="text-muted-foreground flex h-8 items-center justify-center gap-1.5 text-xs"
						activeProps={{className: 'bg-secondary text-foreground font-medium'}}
						activeOptions={{exact: true}}
					>
						{tab.label}
						{tab.count > 0 && (
							<span className="bg-primary text-primary-foreground grid h-4 min-w-4 place-items-center px-1 text-xs font-semibold">
								{tab.count}
							</span>
						)}
					</Link>
				)
			)}
		</nav>
	)
}

function Signed(props: {account: Account}) {
	return pipe(
		Match.value(props.account.role),
		Match.when('Waiting', () => (
			<section className="bg-card flex flex-col gap-2 p-4" role="status">
				<h2 className="flex items-center gap-2 text-sm font-medium">
					<span className="bg-primary size-2 motion-safe:animate-pulse" aria-hidden="true" />
					Waiting for an admin
				</h2>
				<p className="text-muted-foreground text-xs">Your request was sent. This page updates once you are allowed.</p>
			</section>
		)),
		Match.when('Admin', () => (
			<>
				<Suspense fallback={<Loading />}>
					<Tabs />
				</Suspense>
				<Outlet />
			</>
		)),
		Match.orElse(() => <Outlet />)
	)
}

function Shell() {
	const account = useAtomSuspense(accountAtom).value
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [signOut, endSession] = useAtom(signOutAtom)
	const error = Option.orElse(AsyncResult.error(signIn), () => AsyncResult.error(signOut))
	return (
		<>
			<header className="flex items-center gap-2.5">
				<Logo />
				<h1 className="grow text-lg font-semibold">Deslop Auth</h1>
				{Option.match(account, {
					onNone: () => null,
					onSome: signed => (
						<>
							<Avatar id={signed.id} name={signed.name} />
							<span className="max-w-32 truncate text-sm">{signed.fullName ?? signed.name}</span>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label="Sign out"
								disabled={AsyncResult.isWaiting(signOut)}
								onClick={() => endSession()}
							>
								<LogOut />
							</Button>
						</>
					)
				})}
			</header>
			{Option.match(requestId, {onNone: () => null, onSome: id => <Waiting account={account} id={id} />})}
			{Option.match(account, {
				// A waiting sign-in offers GitHub as its last step, under the code.
				onNone: () =>
					Option.isNone(requestId) && (
						<Button size="lg" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
							{Boolean.match(AsyncResult.isWaiting(signIn), {
								onFalse: () => <GitHubIcon />,
								onTrue: () => <LoaderCircle className="motion-safe:animate-spin" />
							})}
							Sign in with GitHub
						</Button>
					),
				onSome: signed =>
					Boolean.match(Option.isSome(requestId) && signed.role !== 'Waiting', {
						onFalse: () => <Signed account={signed} />,
						onTrue: () => null
					})
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
					GitHub sign-in failed. Try again.
				</p>
			)}
		</>
	)
}

function HomeLayout() {
	return (
		<main className="flex flex-1 justify-center overflow-y-auto px-4 py-8 md:py-24">
			<div className="flex w-full max-w-md flex-col gap-5">
				<Suspense fallback={<Loading />}>
					<Shell />
				</Suspense>
			</div>
		</main>
	)
}

export const Route = createFileRoute('/(home)')({component: HomeLayout})
