import {useAtom, useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Match, Number, Option, pipe} from 'effect'

import {HourglassIcon, SignOutIcon} from '@phosphor-icons/react'
import {Link, Outlet, createFileRoute, getRouteApi, useMatchRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useEffect} from 'react'

import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/app-bar'
import {EmptyState, Error} from '@deslop/components-web/fallbacks'
import {Page} from '@deslop/components-web/page'
import {Problem, problemSinceAtom} from '@deslop/components-web/problem'
import * as WebRuntime from '@deslop/runtime/web'

import {accountAtom, appsAtom, catalogAtom, peopleAtom, Search, signOutAtom} from '#lib/utils.ts'
import {AccountMenu} from '#routes/(home)/-account-menu.tsx'
import {SignedOut} from '#routes/(home)/-sign-in.tsx'
import {Waiting} from '#routes/(home)/-waiting.tsx'
import icon from '#routes/icon.svg'
import type {SignedAccount} from '#services/people/schema.ts'

const route = getRouteApi('/(home)')

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
