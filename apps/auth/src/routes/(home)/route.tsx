import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

import {Link, Outlet, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {LoaderCircle} from 'lucide-react'
import {Suspense} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'

import {Avatar, GitHubIcon, QrCode, SignedInGrid} from '#lib/components.tsx'
import {
	accountAtom,
	approveLink,
	codeSignInAtom,
	peopleAtom,
	requestAtom,
	requestCode,
	requestId,
	signInAtom,
	signInLabel,
	signOutAtom,
	timeLabel
} from '#lib/utils.ts'
import icon from '#routes/icon.png'
import type {Account} from '#services/people/schema.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'

// A device that is not signed in: the QR opens the approve page with the code filled in on a phone that is.
function CodeCard(props: {request: PendingAuthorization}) {
	const [signIn, startSignIn] = useAtom(signInAtom)
	return (
		<section className="flex flex-1 flex-col items-center gap-6 pt-6 text-center" aria-label="Waiting sign-in">
			<h2 className="text-xl font-semibold wrap-anywhere">
				{Boolean.match(props.request.kind === 'Browser', {
					onFalse: () => signInLabel(props.request.clientName, props.request.device),
					onTrue: () => 'Sign in this browser'
				})}
			</h2>
			<a
				href={approveLink(props.request.id)}
				aria-label="Approve this sign-in"
				className="bg-foreground rounded-lg p-3"
			>
				<QrCode text={approveLink(props.request.id)} className="text-background size-44" />
			</a>
			<div className="flex flex-col gap-1">
				<p className="font-mono text-3xl font-semibold tracking-widest">{requestCode(props.request.id)}</p>
				<p className="text-muted-foreground font-mono text-xs">{location.host}</p>
			</div>
			<p className="text-muted-foreground mt-auto flex items-center gap-2 font-mono text-xs" role="status">
				<span className="bg-primary size-1.5 rounded-full motion-safe:animate-pulse" aria-hidden="true" />
				Waiting · until {timeLabel(props.request.expiresAt)}
			</p>
			{props.request.kind === 'App' && (
				<Button variant="ghost" size="sm" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
					<GitHubIcon />
					Approve here with GitHub
				</Button>
			)}
		</section>
	)
}

// This browser started the sign-in, so a signed-in account answers it here without a code.
function Waiting(props: {account: Option.Option<Account>; id: string}) {
	return pipe(
		useAtomSuspense(requestAtom(props.id)).value,
		Match.value,
		Match.tagsExhaustive({
			Decided: () => (
				<p className="text-muted-foreground text-sm" role="status">
					Continuing…
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
						onSome: () => (
							<Suspense fallback={<Loading />}>
								<SignedInGrid pending={Option.some(value.request)} />
							</Suspense>
						)
					}
				)
		})
	)
}

// Admins switch between sign-ins and people in the app bar; people waiting for access show as a count.
function Tabs() {
	return (
		<nav className="flex items-center gap-1" aria-label="Sections">
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
						className="text-muted-foreground hover:text-foreground flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium"
						activeProps={{className: 'bg-secondary text-foreground'}}
						activeOptions={{exact: true}}
					>
						{tab.label}
						{tab.count > 0 && <span className="text-primary font-mono">{tab.count}</span>}
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
			<section className="flex flex-col gap-1" role="status">
				<h1 className="flex items-center gap-2 text-xl font-semibold tracking-tight">
					<span className="bg-primary size-1.5 rounded-full motion-safe:animate-pulse" aria-hidden="true" />
					Waiting for an admin
				</h1>
				<p className="text-muted-foreground text-sm">Your request was sent. This page updates once you are allowed.</p>
			</section>
		)),
		Match.orElse(() => <Outlet />)
	)
}

// The account's avatar opens who is signed in and the sign-out.
function AccountMenu(props: {account: Account}) {
	const [signOut, endSession] = useAtom(signOutAtom)
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Account"
				className="focus-visible:ring-ring rounded-full outline-none focus-visible:ring-2"
			>
				<Avatar id={props.account.id} name={props.account.name} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						<span className="text-foreground block text-sm">{props.account.fullName ?? props.account.name}</span>
						{`@${props.account.name} · ${String.toLowerCase(props.account.role)}`}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem variant="destructive" disabled={AsyncResult.isWaiting(signOut)} onClick={() => endSession()}>
					Sign Out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// Without an account: GitHub, or a code approved from another browser, a phone or an agent.
function SignIn() {
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [codeSignIn, startCodeSignIn] = useAtom(codeSignInAtom)
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h1 className="text-xl font-semibold tracking-tight">Sign in</h1>
				<p className="text-muted-foreground text-sm">One account for every mp281x.xyz app.</p>
			</div>
			<div className="flex flex-col gap-2">
				<Button size="lg" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
					{Boolean.match(AsyncResult.isWaiting(signIn), {
						onFalse: () => <GitHubIcon />,
						onTrue: () => <LoaderCircle className="motion-safe:animate-spin" />
					})}
					Sign in with GitHub
				</Button>
				<Button
					size="lg"
					variant="outline"
					disabled={AsyncResult.isWaiting(codeSignIn)}
					onClick={() => startCodeSignIn()}
				>
					Sign in with a Code
				</Button>
			</div>
		</section>
	)
}

function Failures() {
	const [signIn] = useAtom(signInAtom)
	const [codeSignIn] = useAtom(codeSignInAtom)
	const [signOut] = useAtom(signOutAtom)
	return (
		<>
			{Option.match(
				pipe(
					AsyncResult.error(signIn),
					Option.orElse(() => AsyncResult.error(codeSignIn)),
					Option.orElse(() => AsyncResult.error(signOut))
				),
				{
					onNone: () => null,
					onSome: failure => (
						<p className="text-destructive text-sm" role="alert">
							{failure.message}
						</p>
					)
				}
			)}
			{new URLSearchParams(location.search).has('error') && (
				<p className="text-destructive text-sm" role="alert">
					GitHub sign-in failed. Try again.
				</p>
			)}
		</>
	)
}

function Shell() {
	const account = useAtomSuspense(accountAtom).value
	return (
		<>
			<AppBar icon={icon} name="auth">
				{Option.match(account, {
					onNone: () => null,
					onSome: signed => (
						<div className="flex items-center gap-3">
							{signed.role === 'Admin' && (
								<Suspense fallback={null}>
									<Tabs />
								</Suspense>
							)}
							<AccountMenu account={signed} />
						</div>
					)
				})}
			</AppBar>
			<main className="flex flex-1 justify-center overflow-y-auto px-4 py-8 md:py-16">
				<div className="flex w-full max-w-xl flex-col gap-6">
					{Option.match(requestId, {onNone: () => null, onSome: id => <Waiting account={account} id={id} />})}
					{Option.match(account, {
						onNone: () => Option.isNone(requestId) && <SignIn />,
						onSome: signed =>
							Boolean.match(Option.isSome(requestId) && signed.role !== 'Waiting', {
								onFalse: () => <Signed account={signed} />,
								onTrue: () => null
							})
					})}
					<Failures />
				</div>
			</main>
		</>
	)
}

function HomeLayout() {
	return (
		<Suspense fallback={<Loading />}>
			<Shell />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)')({component: HomeLayout})
