import {useAtom, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Option, String, pipe} from 'effect'

import {CheckIcon, CopyIcon, KeyIcon, PlusIcon} from '@phosphor-icons/react'
import {Link, Outlet, createFileRoute, getRouteApi, useMatchRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect} from 'react'

import {AppBar, AppBarTab} from '@deslop/components-web/app-bar'
import type {PaletteGroup} from '@deslop/components-web/command-palette'
import {WEB_APPS} from '@deslop/components-web/command-palette'
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
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
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
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {Spinner} from '@deslop/components-web/ui/spinner'
import * as WebRuntime from '@deslop/runtime/web'

import {AccountAvatar, AppIcon, SignInList, QrCode} from '#lib/components.tsx'
import {
	ADDING_PASSKEY,
	CLIENT_ROWS,
	accountAtom,
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

// The code copies on click; its icon turns into a tick for a moment, in the same place so nothing moves. A failed copy says so beneath.
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
	const next = route.useSearch({select: search => search.next})
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [passkey, startPasskey] = useAtom(passkeySignInAtom)
	return (
		<section
			className="panel panel-ticks m-auto flex w-full max-w-md flex-col overflow-hidden"
			aria-labelledby="waiting-title"
		>
			<header className="bg-surface flex flex-col gap-2 border-b-2 px-4 py-3">
				<p className="text-muted-foreground stamped">Waiting for approval</p>
				<h1
					id="waiting-title"
					title={`Sign in ${props.request.clientName} on ${props.request.device}`}
					className="font-heading text-2xl leading-none tracking-tight"
				>
					{props.request.clientName}
				</h1>
				<p className="text-muted-foreground text-sm">on {props.request.device} · asks to sign in to Deslop</p>
			</header>
			<div className="flex flex-col gap-5 p-4">
				<div className="flex items-start gap-5">
					{/* The theme's own colours, so the dark theme shows light modules on a dark tile. */}
					<span className="bg-background text-foreground border-border shrink-0 rounded-sm border-2 p-2">
						<QrCode text={approveLink(props.request.id)} className="size-32" />
					</span>
					<div className="flex min-w-0 flex-col gap-2">
						<span className="text-muted-foreground stamped">Code</span>
						<Code id={props.request.id} />
						<Countdown expiresAt={props.request.expiresAt} />
						<p className="text-muted-foreground text-xs leading-relaxed">
							Scan the code from a signed-in phone, or enter this code there.
						</p>
					</div>
				</div>
				{/* Signing this browser in turns the page into the approver's, where the sign-in waits to be approved. */}
				{props.request.kind === 'App' && (
					<div className="border-border flex flex-col gap-2 border-t-2 pt-4">
						<Button
							variant="outline"
							size="sm"
							className="w-full"
							disabled={AsyncResult.isWaiting(passkey)}
							onClick={() => startPasskey(next)}
						>
							<KeyIcon />
							Approve here with a passkey
						</Button>
						<Button
							variant="ghost"
							size="sm"
							className="w-full"
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
		</section>
	)
}

// This browser started the sign-in, so a signed-in account answers it here without a code.
function Waiting(props: {account: Option.Option<SignedAccount>; id: string}) {
	return pipe(
		useAtomSuspense(requestAtom(props.id)).value,
		Match.value,
		Match.tagsExhaustive({
			Decided: () => (
				<Empty role="status">
					<EmptyHeader>
						<EmptyTitle>Continuing…</EmptyTitle>
					</EmptyHeader>
				</Empty>
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
							<Suspense fallback={<ItemListSkeleton label="Signed in" media rows={CLIENT_ROWS} />}>
								<SignInList pending={Option.some(value.request)} />
							</Suspense>
						)
					}
				)
		})
	)
}

// Signed-in accounts see their sign-ins; admins also see people, with those waiting as a count.
function Tabs(props: {admin: boolean; waiting: number}) {
	const matchRoute = useMatchRoute()
	const tabs: {count: number; label: string; to: '/' | '/people'}[] = [
		{count: 0, label: 'Sign-ins', to: '/'},
		...Boolean.match(props.admin, {
			onFalse: () => [],
			onTrue: () => [{count: props.waiting, label: 'People', to: '/people' as const}]
		})
	]
	return Array.map(tabs, tab => (
		<AppBarTab key={tab.to} active={matchRoute({to: tab.to}) !== false} render={<Link to={tab.to} />}>
			{tab.label}
			{tab.count > 0 && <Badge>{tab.count}</Badge>}
		</AppBarTab>
	))
}

function Signed(props: {account: SignedAccount}) {
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

// This account's passkeys, each removed from its own submenu; adding one lets the browser offer any kind it can make.
function PasskeyItems(props: {via: SessionVia}) {
	const read = useAtomValue(passkeysAtom)
	const passkeys = AsyncResult.getOrElse(read, () => [])
	const [adding, add] = useAtom(addPasskeyAtom)
	const [removing, remove] = useAtom(removePasskeyAtom)
	const [confirming, confirm] = useAtom(confirmForPasskeyAtom)
	return (
		<DropdownMenuGroup>
			<DropdownMenuLabel>Passkeys</DropdownMenuLabel>
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
				<PlusIcon />
				Add a passkey
			</DropdownMenuItem>
		</DropdownMenuGroup>
	)
}

// The account's avatar opens who is signed in, its passkeys and the sign-out.
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
						<span className="text-foreground block text-sm">{props.account.fullName ?? props.account.name}</span>
						{`@${props.account.name} · ${String.toLowerCase(props.account.role)}`}
					</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				{props.account.role !== 'Waiting' && (
					<>
						<PasskeyItems via={props.account.via} />
						<DropdownMenuSeparator />
					</>
				)}
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

// The suite's marks, announced apps first; a signed-out catalog falls back to the web tools every worker runs.
function Suite(props: {apps: readonly {name: string; origin: string}[]}) {
	return (
		<div className="grid max-w-lg grid-cols-2 gap-x-8 gap-y-3 border-t-2 pt-5 sm:grid-cols-3">
			{Array.map(props.apps, app => (
				<span key={app.origin} className="flex min-w-0 items-center gap-2.5">
					<AppIcon origin={app.origin} small />
					<span className="truncate text-sm">{app.name}</span>
				</span>
			))}
		</div>
	)
}

// Without an account: GitHub, or a code approved from another browser, a phone or an agent.
function SignIn() {
	const next = route.useSearch({select: search => search.next})
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [codeSignIn, startCodeSignIn] = useAtom(codeSignInAtom)
	const [passkey, startPasskey] = useAtom(passkeySignInAtom)
	const apps = AsyncResult.getOrElse(useAtomValue(catalogAtom), () => [])
	return (
		<section className="m-auto flex w-full max-w-sm flex-col gap-6 py-10" aria-label="Sign in">
			<h1 className="sr-only">Sign in</h1>
			<div className="panel panel-ticks bg-card flex w-full flex-col gap-5 overflow-hidden p-4">
				<div className="flex flex-col gap-2">
					<Button size="lg" className="w-full" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
						{Boolean.match(AsyncResult.isWaiting(signIn), {onFalse: () => <GitHubIcon />, onTrue: () => <Spinner />})}
						Continue with GitHub
					</Button>
					<Button
						size="lg"
						variant="outline"
						className="w-full"
						disabled={AsyncResult.isWaiting(passkey)}
						onClick={() => startPasskey(next)}
					>
						{Boolean.match(AsyncResult.isWaiting(passkey), {onFalse: () => <KeyIcon />, onTrue: () => <Spinner />})}
						Continue with a passkey
					</Button>
					<Button
						size="lg"
						variant="ghost"
						className="w-full"
						disabled={AsyncResult.isWaiting(codeSignIn)}
						onClick={() => startCodeSignIn(next)}
					>
						Use a sign-in code
					</Button>
					<Failures />
				</div>
			</div>
			<Suite
				apps={Boolean.match(Array.isReadonlyArrayNonEmpty(apps), {
					onFalse: () => Array.map(WEB_APPS, app => ({name: app.name, origin: app.url})),
					onTrue: () => apps
				})}
			/>
		</section>
	)
}

// Arriving from another app's Sign out ends the session every app shares, then returns there.
function SigningOut() {
	const next = route.useSearch({select: search => search.next})
	const [signOut, endSession] = useAtom(signOutAtom)
	useEffect(() => endSession(next), [endSession, next])
	return Option.match(AsyncResult.error(signOut), {
		onNone: () => (
			<Empty role="status">
				<EmptyHeader>
					<EmptyTitle>Signing out…</EmptyTitle>
				</EmptyHeader>
			</Empty>
		),
		onSome: failure => (
			<Empty role="alert">
				<EmptyHeader>
					<EmptyTitle>Sign-out failed</EmptyTitle>
					<EmptyDescription>{failure.message}</EmptyDescription>
				</EmptyHeader>
				<EmptyContent>
					<Button variant="outline" onClick={() => endSession(next)}>
						Try again
					</Button>
				</EmptyContent>
			</Empty>
		)
	})
}

// A signed-in account narrows its apps or people from the bar, where admins also switch between the two.
function Shell() {
	const search = route.useSearch()
	const requestId = Option.fromUndefinedOr(search.request)
	const signingOut = search['sign-out'] !== undefined
	const account = useAtomSuspense(accountAtom).value
	const catalog = AsyncResult.getOrElse(useAtomValue(catalogAtom), () => [])
	const people = AsyncResult.getOrElse(useAtomValue(peopleAtom), () => [])
	const endSession = useAtomSet(menuSignOutAtom)
	const admin = Option.exists(account, signed => signed.role === 'Admin')
	const waiting = Array.countBy(people, person => person.role === 'Waiting')
	const groups: PaletteGroup[] = [
		{
			items: Array.map(catalog, app => ({
				detail: new URL(app.origin).hostname,
				icon: <AppIcon origin={app.origin} small />,
				id: app.origin,
				keywords: app.name,
				label: app.name,
				run: () => {
					location.assign(app.open)
				}
			})),
			label: 'Apps'
		},
		{
			items: Boolean.match(admin, {
				onFalse: () => [],
				onTrue: () =>
					Array.map(people, person => ({
						detail: `@${person.name} · ${person.role}`,
						icon: <AccountAvatar id={person.id} name={person.name} />,
						id: person.id,
						keywords: `${person.fullName ?? ''} ${person.name}`,
						label: person.fullName ?? person.name,
						run: () => {
							location.assign(`/people#person-${person.id}`)
						}
					}))
			}),
			label: 'People'
		},
		{
			items: [
				{label: 'Sign-ins', run: () => location.assign('/')},
				...Boolean.match(admin, {
					onFalse: () => [],
					onTrue: () => [
						{
							detail: Boolean.match(waiting > 0, {onFalse: () => undefined, onTrue: () => `${waiting} waiting`}),
							label: 'People',
							run: () => location.assign('/people')
						}
					]
				})
			],
			label: 'Go to'
		},
		{
			items: Option.match(account, {
				onNone: () => [],
				onSome: () => [{label: 'Sign out of every app', run: () => endSession(search.next)}]
			}),
			label: 'Account'
		}
	]
	return (
		<>
			<AppBar
				icon={icon}
				name="auth"
				account={Option.match(account, {onNone: () => false, onSome: signed => <AccountMenu account={signed} />})}
				palette={Option.match(account, {onNone: () => undefined, onSome: () => groups})}
				tabs={Option.exists(account, signed => signed.role !== 'Waiting') && <Tabs admin={admin} waiting={waiting} />}
			/>
			<Page>
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
			</Page>
		</>
	)
}

// Until the account is known: the app bar and the sign-in card's shape, never a blank page with a spinner.
function HomeLayout() {
	return (
		<Suspense
			fallback={
				<>
					<AppBar icon={icon} name="auth" account={false} />
					<Page>
						<section
							aria-busy="true"
							aria-label="Sign in"
							role="status"
							className="flex flex-1 flex-col items-center justify-center gap-6 pb-12"
						>
							<div className="flex flex-col items-center gap-2">
								<Skeleton className="h-7 w-52" />
								<Skeleton className="h-4 w-44" />
							</div>
							<div className="flex w-full max-w-sm flex-col gap-2 rounded-lg border-2 p-4">
								<Skeleton className="h-11 w-full" />
								<Skeleton className="h-4 w-8 self-center" />
								<Skeleton className="h-11 w-full" />
								<Skeleton className="h-11 w-full" />
							</div>
						</section>
					</Page>
				</>
			}
		>
			<Shell />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)')({component: HomeLayout, validateSearch: WebRuntime.searchOf(Search)})
