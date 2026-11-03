import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, Copy} from 'lucide-react'
import {Suspense, useEffect} from 'react'

import {AppBar, AppBarTab} from '@deslop/components-web/app-bar'
import {GitHubIcon} from '@deslop/components-web/icons'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Page} from '@deslop/components-web/page'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Badge} from '@deslop/components-web/ui/badge'
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
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle
} from '@deslop/components-web/ui/empty'
import {FieldError} from '@deslop/components-web/ui/field'
import {Spinner} from '@deslop/components-web/ui/spinner'

import {AccountAvatar, AppList, QrCode} from '#lib/components.tsx'
import {
	APP_ROWS,
	accountAtom,
	approveLink,
	codeSignInAtom,
	copyCodeAtom,
	leftLabel,
	peopleAtom,
	requestAtom,
	requestCode,
	requestId,
	secondAtom,
	signInAtom,
	signOutAtom,
	signingOut
} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import type {Account} from '#services/people/schema.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'

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
				{onNone: () => null, onSome: failure => <FieldError>{failure.message}</FieldError>}
			)}
			{new URLSearchParams(location.search).has('error') && <FieldError>GitHub sign-in failed. Try again.</FieldError>}
		</>
	)
}

// The code copies on click; its icon turns into a tick for a moment, in the same place so nothing moves. A failed copy says so beneath.
function Code(props: {id: string}) {
	const [copy, copyCode] = useAtom(copyCodeAtom)
	const copied = AsyncResult.isWaiting(copy)
	return (
		<>
			<Button
				variant="ghost"
				aria-label={`Copy the code ${requestCode(props.id)}`}
				className="font-mono text-base font-semibold"
				onClick={() => copyCode(requestCode(props.id))}
			>
				{requestCode(props.id)}
				{Boolean.match(copied, {
					onFalse: () => <Copy className="text-muted-foreground" />,
					onTrue: () => <Check className="text-primary" />
				})}
				<span role="status" className="sr-only">
					{copied && 'Copied'}
				</span>
			</Button>
			<ResultError result={copy} />
		</>
	)
}

// Its own component, so only the time re-renders each second; the dot alone turns yellow in the last minute, so the time stays legible.
function Countdown(props: {expiresAt: number}) {
	const now = useAtomSuspense(secondAtom).value
	return (
		<span role="timer" className="text-muted-foreground flex items-center gap-1.5 text-xs">
			<StatusDot
				waiting
				status={Boolean.match(props.expiresAt - now < 60_000, {onFalse: () => 'live', onTrue: () => 'warning'})}
			/>
			<span>
				<span className="font-mono tabular-nums">{leftLabel(props.expiresAt, now)}</span> left
			</span>
		</span>
	)
}

// A device that is not signed in, centred and sparse: who asks, a QR a signed-in phone scans, its code to copy, its time running down.
function CodeCard(props: {request: PendingAuthorization}) {
	const [signIn, startSignIn] = useAtom(signInAtom)
	const title = `Sign in ${props.request.clientName} on ${props.request.device}`
	return (
		<section
			className="flex flex-1 flex-col items-center justify-center gap-3 pb-12 text-center"
			aria-labelledby="waiting-title"
		>
			<p id="waiting-title" title={title} className="max-w-full truncate text-base font-semibold">
				{title}
			</p>
			{/* The theme's own colours, so the dark theme shows light modules on a dark tile. */}
			<span className="bg-card text-foreground rounded-md border p-1.5">
				<QrCode text={approveLink(props.request.id)} className="size-40" />
			</span>
			<Code id={props.request.id} />
			<Countdown expiresAt={props.request.expiresAt} />
			{props.request.kind === 'App' && (
				<Button variant="ghost" size="sm" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
					<GitHubIcon />
					Approve here with GitHub
				</Button>
			)}
			<Failures />
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
			// The link stays expired on every reload, so the way out drops it: Auth's own sign-in, or its sign-ins when signed in.
			Expired: () => (
				<Empty role="status">
					<EmptyHeader>
						<EmptyTitle>This sign-in expired</EmptyTitle>
						<EmptyDescription>Start it again in the app or agent that asked.</EmptyDescription>
					</EmptyHeader>
					<EmptyContent>
						<Button variant="outline" onClick={() => location.assign('/')}>
							Back to Auth
						</Button>
					</EmptyContent>
				</Empty>
			),
			Waiting: value =>
				Option.match(
					Option.filter(props.account, signed => signed.role !== 'Waiting'),
					{
						onNone: () => <CodeCard request={value.request} />,
						onSome: () => (
							<Suspense fallback={<ItemListSkeleton label="Apps" media rows={APP_ROWS} />}>
								<AppList pending={Option.some(value.request)} />
							</Suspense>
						)
					}
				)
		})
	)
}

// Admins switch between sign-ins and people in the app bar; people waiting for access show as a count.
function Tabs() {
	const matchRoute = useMatchRoute()
	return Array.map(
		[
			{count: 0, label: 'Sign-ins', to: '/'},
			{
				count: Array.countBy(useAtomSuspense(peopleAtom).value, person => person.role === 'Waiting'),
				label: 'People',
				to: '/people'
			}
		] as const,
		tab => (
			<AppBarTab key={tab.to} active={matchRoute({to: tab.to}) !== false} render={<Link to={tab.to} />}>
				{tab.label}
				{tab.count > 0 && <Badge>{tab.count}</Badge>}
			</AppBarTab>
		)
	)
}

function Signed(props: {account: Account}) {
	return pipe(
		Match.value(props.account.role),
		Match.when('Waiting', () => (
			<Empty role="status">
				<EmptyHeader>
					<EmptyMedia>
						<StatusDot waiting />
					</EmptyMedia>
					<EmptyTitle>Waiting for an admin</EmptyTitle>
				</EmptyHeader>
			</Empty>
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
				<AccountAvatar id={props.account.id} name={props.account.name} />
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
					Sign out
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
		<section className="flex flex-1 flex-col justify-center gap-2 pb-12" aria-label="Sign in">
			<Button size="lg" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
				{Boolean.match(AsyncResult.isWaiting(signIn), {onFalse: () => <GitHubIcon />, onTrue: () => <Spinner />})}
				Sign in with GitHub
			</Button>
			<Button
				size="lg"
				variant="outline"
				disabled={AsyncResult.isWaiting(codeSignIn)}
				onClick={() => startCodeSignIn()}
			>
				Sign in with a code
			</Button>
			<Failures />
		</section>
	)
}

// Arriving from another app's Sign out ends the session every app shares, then returns there.
function SigningOut() {
	const [signOut, endSession] = useAtom(signOutAtom)
	useEffect(() => endSession(), [endSession])
	return (
		<p className="text-muted-foreground text-sm" role="status">
			{Boolean.match(AsyncResult.isFailure(signOut), {onFalse: () => 'Signing out…', onTrue: () => 'Sign-out failed.'})}
		</p>
	)
}

// A signed-in account narrows its apps or people from the bar, where admins also switch between the two.
function Shell() {
	const account = useAtomSuspense(accountAtom).value
	// The sign-in buttons and a waiting sign-in sit centred with their own failures beneath them, rather than at the page's foot.
	const centred = Boolean.match(Option.isSome(requestId), {
		onFalse: () => Option.isNone(account) && !signingOut,
		onTrue: () => !Option.exists(account, signed => signed.role !== 'Waiting')
	})
	return (
		<>
			<AppBar
				icon={icon}
				name="auth"
				account={Option.match(account, {onNone: () => false, onSome: signed => <AccountMenu account={signed} />})}
				tabs={
					Option.exists(account, signed => signed.role === 'Admin') && (
						<Suspense fallback={null}>
							<Tabs />
						</Suspense>
					)
				}
				commands={Option.match(
					Option.filter(account, signed => signed.role !== 'Waiting'),
					{onNone: () => undefined, onSome: () => []}
				)}
			/>
			<Page className="max-w-xl">
				{signingOut && <SigningOut />}
				{Option.match(requestId, {onNone: () => null, onSome: id => <Waiting account={account} id={id} />})}
				{Option.match(account, {
					onNone: () => Option.isNone(requestId) && !signingOut && <SignIn />,
					onSome: signed =>
						Boolean.match(Option.isSome(requestId) && signed.role !== 'Waiting', {
							onFalse: () => <Signed account={signed} />,
							onTrue: () => null
						})
				})}
				{!centred && <Failures />}
			</Page>
		</>
	)
}

// Until the account is known: the app bar and the page's shape, never a blank page with a spinner.
function HomeLayout() {
	return (
		<Suspense
			fallback={
				<>
					<AppBar icon={icon} name="auth" account={false} />
					<Page className="max-w-xl">
						<ItemListSkeleton label="Apps" media rows={APP_ROWS} />
					</Page>
				</>
			}
		>
			<Shell />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)')({component: HomeLayout})
