import {useAtomRefresh, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Function, Match, Option, Schema, pipe} from 'effect'

import {HourglassIcon, SignOutIcon} from '@phosphor-icons/react'
import {Link, Outlet, createFileRoute, getRouteApi, useMatchRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {StaleProblem} from '@deslop/components-web/blocks/problem'
import {FailureRetry} from '@deslop/components-web/blocks/states'
import {AppBarTab, AppBar, AppBarTabs} from '@deslop/components-web/shell/app-bar'
import {Page} from '@deslop/components-web/shell/page'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'

import {accountAtom, appsAtom, peopleAtom, Search, signingOutAtom} from '#lib/auth.ts'
import {AccountMenu} from '#routes/(home)/-account-menu.tsx'
import {SignIn} from '#routes/(home)/-sign-in.tsx'
import {Waiting} from '#routes/(home)/-waiting.tsx'
import icon from '#routes/icon.svg'
import type {SignedAccount} from '#services/people/schema.ts'

const route = getRouteApi('/(home)')

type TabRoute = typeof TabRoute.Type
const TabRoute = Schema.Literals(['/', '/people'])

// Signed-in accounts see their sign-ins; admins also see people.
function Tabs(props: {admin: boolean}) {
	const matchRoute = useMatchRoute()
	const tabs = pipe(
		TabRoute.literals,
		Array.filter(to => to === '/' || props.admin),
		Array.map(to => ({
			label: Boolean.match(to === '/', {onFalse: Function.constant('People'), onTrue: Function.constant('Sign-ins')}),
			to
		}))
	)
	return (
		<AppBarTabs
			value={Boolean.match(matchRoute({to: '/people'}) !== false, {
				onFalse: Function.constant('/'),
				onTrue: Function.constant('/people')
			})}
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
			<Empty role="status">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<HourglassIcon />
					</EmptyMedia>
					<EmptyTitle>Waiting for an admin</EmptyTitle>
				</EmptyHeader>
			</Empty>
		)),
		Match.orElse(() => <Outlet />)
	)
}

function SigningOut() {
	const next = route.useSearch({select: search => search.next})
	const signOut = useAtomValue(signingOutAtom(next))
	const retry = useAtomRefresh(signingOutAtom(next))
	return Option.match(AsyncResult.error(signOut), {
		onNone: () => (
			<Empty role="status">
				<EmptyHeader>
					<EmptyMedia variant="icon">
						<SignOutIcon />
					</EmptyMedia>
					<EmptyTitle>Signing out</EmptyTitle>
				</EmptyHeader>
			</Empty>
		),
		onSome: () => <FailureRetry label="Sign-out failed" reset={retry} />
	})
}

function PageProblem() {
	return (
		<StaleProblem
			label="Out of date"
			readers={Boolean.match(useMatchRoute()({to: '/people'}) !== false, {
				onFalse: () => [appsAtom],
				onTrue: () => [appsAtom, peopleAtom]
			})}
		/>
	)
}

// The account menu joins the mounted bar once the account is known.
function AccountControl() {
	return Option.match(useAtomSuspense(accountAtom).value, {
		onNone: Function.constFalse,
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
	const requestId = search.request
	const signingOut = Option.isSome(search['sign-out'])
	const account = useAtomSuspense(accountAtom).value
	return (
		<Page>
			{signingOut && <SigningOut />}
			{Option.match(requestId, {onNone: Function.constNull, onSome: id => <Waiting account={account} id={id} />})}
			{Option.match(account, {
				onNone: () => Option.isNone(requestId) && !signingOut && <SignIn />,
				onSome: signed =>
					Boolean.match(Option.isSome(requestId) && signed.role !== 'Waiting', {
						onFalse: () => <Signed account={signed} />,
						onTrue: Function.constNull
					})
			})}
		</Page>
	)
}

// The bar mounts once and stays; its account and tabs join it when known, and no page skeleton shows before the account is known.
function ShellRoute() {
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

export const Route = createFileRoute('/(home)')({
	component: ShellRoute,
	validateSearch: Schema.toStandardSchemaV1(Search)
})
