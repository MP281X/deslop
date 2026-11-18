import {Boolean, Function, Option, Schema, pipe} from 'effect'

import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router'
import {Suspense} from 'react'

import {StaleProblem} from '@deslop/components-web/blocks/problem'
import {Loaded} from '@deslop/components-web/blocks/states'
import {preload} from '@deslop/components-web/lib/router'
import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/shell/app-bar'
import {Page} from '@deslop/components-web/shell/page'

import {accountAtom, peopleAtom, Search, sessionsAtom} from '#lib/auth.ts'
import {AccountMenu} from '#routes/(home)/-account-menu.tsx'
import {SignIn} from '#routes/(home)/-sign-in.tsx'
import icon from '#routes/icon.svg'
import type {SignedAccount} from '#services/people/schema.ts'

function Content(props: {account: Option.Option<SignedAccount>}) {
	const tab = Boolean.match(useMatchRoute()({to: '/people'}) !== false, {
		onFalse: Function.constant('/' as const),
		onTrue: Function.constant('/people' as const)
	})
	return (
		<>
			<AppBar
				name="auth"
				icon={icon}
				account={Option.match(props.account, {
					onNone: Function.constNull,
					onSome: user => <AccountMenu account={user} />
				})}
				controls={
					<StaleProblem
						label="Out of date"
						readers={pipe(
							props.account,
							Option.exists(user => user.role !== 'Waiting'),
							Boolean.match({
								onFalse: () => [accountAtom],
								onTrue: () => [accountAtom, {'/': sessionsAtom, '/people': peopleAtom}[tab]]
							})
						)}
					/>
				}
				tabs={
					Option.exists(props.account, user => user.role === 'Admin') && (
						<AppBarTabs value={tab}>
							<AppBarTab value="/" render={<Link to="/" search={{}} />}>
								Sessions
							</AppBarTab>
							<AppBarTab value="/people" render={<Link to="/people" search={{}} />}>
								People
							</AppBarTab>
						</AppBarTabs>
					)
				}
			/>
			<Page>
				{Option.match(props.account, {
					onNone: () => <SignIn />,
					onSome: user =>
						Boolean.match(user.role === 'Waiting', {
							onFalse: () => <Outlet />,
							onTrue: () => <p className="text-muted-foreground m-auto">Waiting for an admin</p>
						})
				})}
			</Page>
		</>
	)
}
// An outage keeps the last account on screen, marked out of date; with none kept, the failure is the page.
function ShellRoute() {
	return (
		<Suspense fallback={null}>
			<Loaded atom={accountAtom}>{account => <Content account={account} />}</Loaded>
		</Suspense>
	)
}
export const Route = createFileRoute('/(home)')({
	component: ShellRoute,
	loader: load => preload(load, [accountAtom]),
	validateSearch: Schema.toStandardSchemaV1(Search)
})
