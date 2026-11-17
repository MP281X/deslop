import {useAtomSuspense} from '@effect/atom-react'

import {Boolean, Function, Option, Schema} from 'effect'

import {Link, Outlet, createFileRoute, useMatchRoute} from '@tanstack/react-router'
import {Suspense} from 'react'

import {preload} from '@deslop/components-web/lib/router'
import {AppBar, AppBarTab, AppBarTabs} from '@deslop/components-web/shell/app-bar'
import {Page} from '@deslop/components-web/shell/page'

import {accountAtom, Search} from '#lib/auth.ts'
import {AccountMenu} from '#routes/(home)/-account-menu.tsx'
import {SignIn} from '#routes/(home)/-sign-in.tsx'
import icon from '#routes/icon.svg'

function Content() {
	const account = useAtomSuspense(accountAtom).value
	const match = useMatchRoute()
	return (
		<>
			<AppBar
				name="auth"
				icon={icon}
				account={Option.match(account, {onNone: Function.constNull, onSome: user => <AccountMenu account={user} />})}
				tabs={
					Option.exists(account, user => user.role === 'Admin') && (
						<AppBarTabs
							value={Boolean.match(match({to: '/people'}) !== false, {
								onFalse: Function.constant('/'),
								onTrue: Function.constant('/people')
							})}
						>
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
				{Option.match(account, {
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
function ShellRoute() {
	return (
		<Suspense fallback={null}>
			<Content />
		</Suspense>
	)
}
export const Route = createFileRoute('/(home)')({
	component: ShellRoute,
	loader: load => preload(load.context, [accountAtom]),
	validateSearch: Schema.toStandardSchemaV1(Search)
})
