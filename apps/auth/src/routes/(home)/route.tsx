import {useAtom, useAtomRefresh, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, pipe} from 'effect'

import {ArrowRightIcon, CheckIcon, CopyIcon, HourglassIcon, KeyIcon, SignOutIcon} from '@phosphor-icons/react'
import {Link, Outlet, createFileRoute, getRouteApi, useMatchRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect} from 'react'

import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {EmptyState, Error} from '@deslop/components-web/fallbacks'
import {GitHubIcon} from '@deslop/components-web/icons'
import {Page} from '@deslop/components-web/page'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import {ResultError} from '@deslop/components-web/result-error'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '@deslop/components-web/ui/dropdown-menu'
import {FieldError} from '@deslop/components-web/ui/field'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import * as WebRuntime from '@deslop/runtime/web'

import {AccountAvatar, AppIcon, SignInList, SignInRowsSkeleton, QrCode} from '#lib/components.tsx'
import {
	ADDING_PASSKEY,
	accountAtom,
	appsAtom,
	approveLink,
	addPasskeyAtom,
	catalogAtom,
	codeSignInAtom,
	confirmForPasskeyAtom,
	passkeySignInAtom,
	passkeysAtom,
	removePasskeyAtom,
	copyCodeAtom,
	leftLabel,
	peopleAtom,
	requestAtom,
	requestCode,
	Search,
	secondAtom,
	signInAtom,
	signInLabel,
	menuSignOutAtom,
	signOutAtom
} from '#lib/utils.ts'
import icon from '#routes/icon.svg'
import type {SignedAccount} from '#services/people/schema.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'
import type {SessionVia} from '#services/tokens/schema.ts'

const route = getRouteApi('/(home)')

function Failures() {
	const failed = route.useSearch({select: search => search.error !== undefined})
	const [signIn] = useAtom(signInAtom)
	const [codeSignIn] = useAtom(codeSignInAtom)
	const [passkey] = useAtom(passkeySignInAtom)
	return (
		<>
			{Option.match(
				pipe(
					AsyncResult.error(signIn),
					Option.orElse(() => AsyncResult.error(codeSignIn)),
					Option.orElse(() => AsyncResult.error(passkey))
				),
				{onNone: () => null, onSome: failure => <FieldError>{failure.message}</FieldError>}
			)}
			{failed && <FieldError>GitHub sign-in failed. Try again.</FieldError>}
		</>
	)
}

function Code(props: {id: string}) {
	const [copy, copyCode] = useAtom(copyCodeAtom)
	const copied = AsyncResult.isWaiting(copy)
	return (
		<>
			<Button
				variant="ghost"
				aria-label={`Copy the code ${requestCode(props.id)}`}
				onClick={() => copyCode(requestCode(props.id))}
			>
				{requestCode(props.id)}
				{Boolean.match(copied, {
					onFalse: () => <CopyIcon className="text-muted-foreground" />,
					onTrue: () => <CheckIcon className="text-primary" />
				})}
				<span role="status" className="sr-only">
					{copied && 'Copied'}
				</span>
			</Button>
			<ResultError result={copy} />
		</>
	)
}

// Its own component, so only the time re-renders each second; only the last minute carries the warning dot.
function Countdown(props: {expiresAt: number}) {
	const now = useAtomSuspense(secondAtom).value
	return (
		<span role="timer" className="text-muted-foreground flex items-center gap-1.5 text-xs">
			{props.expiresAt - now < 60_000 && <StatusDot status="warning" />}
			<span>
				<span className="font-mono tabular-nums">{leftLabel(props.expiresAt, now)}</span> left
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
						<Code id={props.request.id} />
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
function Waiting(props: {account: Option.Option<SignedAccount>; id: string}) {
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
				Option.match(
					Option.filter(props.account, signed => signed.role !== 'Waiting'),
					{
						onNone: () => <CodeCard request={value.request} />,
						onSome: () => (
							<Suspense fallback={<SignInRowsSkeleton pending />}>
								<SignInList pending={Option.some(value.request)} />
							</Suspense>
						)
					}
				)
		})
	)
}

// Signed-in accounts see their sign-ins; admins also see people.
function Tabs(props: {admin: boolean}) {
	const matchRoute = useMatchRoute()
	const tabs: {label: string; to: '/' | '/people'}[] = [
		{label: 'Sign-ins', to: '/'},
		...Boolean.match(props.admin, {onFalse: () => [], onTrue: () => [{label: 'People', to: '/people' as const}]})
	]
	return (
		<AppBarTabs
			value={Boolean.match(matchRoute({to: '/people'}) !== false, {onFalse: () => '/', onTrue: () => '/people'})}
		>
			{Array.map(tabs, tab => (
				<AppBarTab key={tab.to} value={tab.to} render={<Link to={tab.to} />}>
					{tab.label}
				</AppBarTab>
			))}
		</AppBarTabs>
	)
}

function Signed(props: {account: SignedAccount}) {
	return pipe(
		Match.value(props.account.role),
		Match.when('Waiting', () => (
			<EmptyState label="Waiting for an admin" icon={<HourglassIcon className="size-5" weight="light" />} />
		)),
		Match.orElse(() => <Outlet />)
	)
}

function PasskeyItems(props: {via: SessionVia}) {
	const read = useAtomValue(passkeysAtom)
	const passkeys = AsyncResult.getOrElse(read, () => [])
	const [adding, add] = useAtom(addPasskeyAtom)
	const [removing, remove] = useAtom(removePasskeyAtom)
	const [confirming, confirm] = useAtom(confirmForPasskeyAtom)
	return (
		<DropdownMenuGroup>
			{/* A failed read says so, rather than looking like an account without passkeys. */}
			{Option.match(AsyncResult.error(read), {
				onNone: () => null,
				onSome: failure => (
					<DropdownMenuItem disabled className="max-sm:h-11">
						<span className="text-destructive text-xs">Passkeys unavailable · {failure.message}</span>
					</DropdownMenuItem>
				)
			})}
			{Array.map(passkeys, passkey => (
				<DropdownMenuSub key={passkey.id}>
					<DropdownMenuSubTrigger>
						<KeyIcon />
						<span className="truncate">{passkey.addedFrom}</span>
						<span className="text-muted-foreground ml-auto pl-3 text-xs">
							{Boolean.match(passkey.synced, {onFalse: () => 'One device', onTrue: () => 'Synced'})}
						</span>
					</DropdownMenuSubTrigger>
					<DropdownMenuSubContent>
						<DropdownMenuItem
							variant="destructive"
							className="max-sm:h-11"
							disabled={AsyncResult.isWaiting(removing)}
							onClick={() => remove(passkey.id)}
						>
							Remove
						</DropdownMenuItem>
					</DropdownMenuSubContent>
				</DropdownMenuSub>
			))}
			{/* A code may have been approved for someone else's browser, so a code session passes through GitHub before it adds a year-long passkey. */}
			<DropdownMenuItem
				className="max-sm:h-11"
				disabled={AsyncResult.isWaiting(adding) || AsyncResult.isWaiting(confirming)}
				onClick={() => Boolean.match(props.via === 'Code', {onFalse: () => add(), onTrue: () => confirm()})}
			>
				<KeyIcon />
				Add a passkey
			</DropdownMenuItem>
		</DropdownMenuGroup>
	)
}

function AccountMenu(props: {account: SignedAccount}) {
	const next = route.useSearch({select: search => search.next})
	const [signOut, endSession] = useAtom(menuSignOutAtom)
	const add = useAtomSet(addPasskeyAtom)
	// Back from GitHub, the passkey it went for starts at once, and only once.
	useEffect(() => {
		if (sessionStorage.getItem(ADDING_PASSKEY) === null) return
		sessionStorage.removeItem(ADDING_PASSKEY)
		if (props.account.via !== 'Code') add()
	}, [add, props.account.via])
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Account"
				render={<Button variant="ghost" size="icon" className="max-sm:size-11" />}
			>
				<AccountAvatar id={props.account.id} name={props.account.name} />
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>
						<span className="text-foreground">{`@${props.account.name}`}</span>
						{props.account.role === 'Admin' && <span className="text-muted-foreground"> admin</span>}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				{props.account.role !== 'Waiting' && <PasskeyItems via={props.account.via} />}
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					className="max-sm:h-11"
					disabled={AsyncResult.isWaiting(signOut)}
					onClick={() => endSession(next)}
				>
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// The suite's apps, as they announced themselves to Auth; each opens its app.
function Suite(props: {apps: readonly {name: string; origin: string}[]}) {
	return (
		<nav aria-label="Apps" className="grid grid-cols-2 gap-x-8 gap-y-3 border-t pt-5">
			{Array.map(props.apps, app => (
				<a
					key={app.origin}
					href={app.origin}
					className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-2.5 max-sm:h-11"
				>
					<AppIcon origin={app.origin} />
					<span className="truncate">{app.name}</span>
				</a>
			))}
		</nav>
	)
}

// The signed-out page's centred shape while its app list loads, never a skeleton for the bar, tabs, a heading or the code field.
function SignInSkeleton() {
	return (
		<section
			aria-busy="true"
			aria-label="Sign in"
			role="status"
			className="m-auto flex w-full -translate-y-2 flex-col gap-5 sm:max-w-80 lg:-translate-y-3"
		>
			<div className="flex flex-col gap-2">
				<Skeleton className="h-9 w-full max-sm:h-11" />
				<Skeleton className="h-9 w-full max-sm:h-11" />
				<Skeleton className="h-9 w-full max-sm:h-11" />
			</div>
			<div className="grid grid-cols-2 gap-x-8 gap-y-3 border-t pt-5">
				{Array.map(Array.range(1, 4), row => (
					<span key={row} className="flex h-6 min-w-0 items-center gap-2.5 max-sm:h-11">
						<Skeleton className="size-4 shrink-0" />
						<Skeleton className="h-3 w-20" />
					</span>
				))}
			</div>
		</section>
	)
}

function SignIn(props: {apps: readonly {name: string; origin: string}[]}) {
	const next = route.useSearch({select: search => search.next})
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [codeSignIn, startCodeSignIn] = useAtom(codeSignInAtom)
	const [passkey, startPasskey] = useAtom(passkeySignInAtom)
	return (
		<section
			className="m-auto flex w-full -translate-y-2 flex-col gap-5 sm:max-w-80 lg:-translate-y-3"
			aria-label="Sign in"
		>
			<h1 className="sr-only">Sign in</h1>
			<div className="flex flex-col gap-2">
				<Button
					size="lg"
					className="w-full max-sm:h-11"
					disabled={AsyncResult.isWaiting(signIn)}
					onClick={() => startSignIn()}
				>
					<GitHubIcon />
					Continue with GitHub
				</Button>
				<Button
					size="lg"
					variant="outline"
					className="w-full max-sm:h-11"
					disabled={AsyncResult.isWaiting(passkey)}
					onClick={() => startPasskey(next)}
				>
					<KeyIcon />
					Continue with a passkey
				</Button>
				<Button
					size="lg"
					variant="ghost"
					className="w-full max-sm:h-11"
					disabled={AsyncResult.isWaiting(codeSignIn)}
					onClick={() => startCodeSignIn(next)}
				>
					Use a sign-in code
				</Button>
				<Failures />
			</div>
			{Array.isReadonlyArrayNonEmpty(props.apps) && <Suite apps={props.apps} />}
		</section>
	)
}

// A known signed-out account sees the sign-in page; until its app list arrives, the page's centred shape stands in.
function SignedOut() {
	const catalog = useAtomValue(catalogAtom)
	if (AsyncResult.isInitial(catalog)) return <SignInSkeleton />
	return <SignIn apps={AsyncResult.getOrElse(catalog, () => [])} />
}

function SigningOut() {
	const next = route.useSearch({select: search => search.next})
	const [signOut, endSession] = useAtom(signOutAtom)
	useEffect(() => endSession(next), [endSession, next])
	return Option.match(AsyncResult.error(signOut), {
		onNone: () => <EmptyState label="Signing out" icon={<SignOutIcon weight="light" />} />,
		onSome: failure => <Error error={failure} label="Sign-out failed" reset={() => endSession(next)} />
	})
}

// The page shows staleness once, as the oldest stale reader; one retry refreshes them all.
function PageProblem() {
	const appsSince = useAtomValue(problemSinceAtom(appsAtom))
	const catalogSince = useAtomValue(problemSinceAtom(catalogAtom))
	const peopleSince = useAtomValue(problemSinceAtom(peopleAtom))
	const refreshApps = useAtomRefresh(appsAtom)
	const refreshCatalog = useAtomRefresh(catalogAtom)
	const refreshPeople = useAtomRefresh(peopleAtom)
	return Option.match(
		Array.reduce(
			Array.flatMap([appsSince, catalogSince, peopleSince], Option.toArray),
			Option.none<number>(),
			(oldest, value) =>
				Option.some(Option.match(oldest, {onNone: () => value, onSome: current => Number.min(current, value)}))
		),
		{
			onNone: () => null,
			onSome: value => (
				<Problem
					label="Out of date"
					warning
					since={value}
					reset={() => {
						refreshApps()
						refreshCatalog()
						refreshPeople()
					}}
				/>
			)
		}
	)
}

// The account menu joins the mounted bar once the account is known.
function AccountControl() {
	return Option.match(useAtomSuspense(accountAtom).value, {
		onNone: () => false,
		onSome: signed => <AccountMenu account={signed} />
	})
}

// The section tabs join the mounted bar once the account is known; admins also see people.
function TabsControl() {
	const account = useAtomSuspense(accountAtom).value
	const admin = Option.exists(account, signed => signed.role === 'Admin')
	return Option.exists(account, signed => signed.role !== 'Waiting') && <Tabs admin={admin} />
}

// A signed-in account switches between its sign-ins and people; the page waits for the account under the mounted bar.
function ShellPage() {
	const search = route.useSearch()
	const requestId = Option.fromUndefinedOr(search.request)
	const signingOut = search['sign-out'] !== undefined
	const account = useAtomSuspense(accountAtom).value
	return (
		<Page width="column">
			{signingOut && <SigningOut />}
			{Option.match(requestId, {onNone: () => null, onSome: id => <Waiting account={account} id={id} />})}
			{Option.match(account, {
				onNone: () => Option.isNone(requestId) && !signingOut && <SignedOut />,
				onSome: signed =>
					Boolean.match(Option.isSome(requestId) && signed.role !== 'Waiting', {
						onFalse: () => <Signed account={signed} />,
						onTrue: () => null
					})
			})}
		</Page>
	)
}

// The bar mounts once and stays; its account and tabs join it when known, and no page skeleton shows before the account is known.
function Shell() {
	return (
		<>
			<AppBar
				icon={icon}
				name="auth"
				account={
					<Suspense fallback={false}>
						<AccountControl />
					</Suspense>
				}
				controls={<PageProblem />}
				tabs={
					<Suspense fallback={null}>
						<TabsControl />
					</Suspense>
				}
			/>
			<Suspense fallback={null}>
				<ShellPage />
			</Suspense>
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: Shell, validateSearch: WebRuntime.searchOf(Search)})
