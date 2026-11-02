import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect} from 'react'

import {AppBar, AppBarTab} from '@deslop/components-web/app-bar'
import {GitHubIcon} from '@deslop/components-web/icons'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Page} from '@deslop/components-web/page'
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
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {FieldError} from '@deslop/components-web/ui/field'
import {Spinner} from '@deslop/components-web/ui/spinner'

import {AccountAvatar, AppList, QrCode} from '#lib/components.tsx'
import {
	APP_ROWS,
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
	signingOut,
	timeLabel
} from '#lib/utils.ts'
import icon from '#routes/icon-dark.svg'
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
				<StatusDot waiting />
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
			Expired: () => <FieldError>This request expired. Start sign-in again in the app.</FieldError>,
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
		<section className="flex flex-col gap-2" aria-label="Sign in">
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
				{onNone: () => null, onSome: failure => <FieldError>{failure.message}</FieldError>}
			)}
			{new URLSearchParams(location.search).has('error') && <FieldError>GitHub sign-in failed. Try again.</FieldError>}
		</>
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
				<Failures />
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
