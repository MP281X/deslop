import {useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Cause, Option, Schema} from 'effect'

import {Link, Outlet, createFileRoute, useMatchRoute, useNavigate, useSearch} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {buttonVariants} from '@deslop/components-web/ui/button'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {inventoryAtom} from '#lib/utils.ts'
import icon from '#routes/icon-dark.svg'

function Fleet() {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const search = useSearch({from: '/(home)'})
	const navigate = useNavigate({from: '/'})
	const matchRoute = useMatchRoute()
	if (AsyncResult.isFailure(result)) {
		if (Option.exists(Cause.findErrorOption(result.cause), error => error._tag === 'AuthError')) {
			return <SignIn href={signInUrl(location.href)} />
		}
		return <Error error={Cause.squash(result.cause)} reset={() => location.reload()} />
	}
	return (
		<>
			<ToggleGroup
				aria-label="Machine"
				value={[search.machine ?? 'all']}
				onValueChange={values => {
					if (values[0] !== undefined) {
						navigate({
							search: {machine: values[0]},
							to: Boolean.match(matchRoute({to: '/monitor'}) !== false, {
								onFalse: () => '/' as const,
								onTrue: () => '/monitor' as const
							})
						})
					}
				}}
			>
				<ToggleGroupItem value="all">All machines</ToggleGroupItem>
				{Array.map(result.value.workers ?? Array.dedupe(Array.map(result.value.items, item => item.worker)), worker => (
					<ToggleGroupItem key={worker} value={worker} className="gap-1.5">
						<MachineIcon worker={worker} />
						{machineName(worker)}
					</ToggleGroupItem>
				))}
			</ToggleGroup>
			<Outlet />
		</>
	)
}

function Shell() {
	const matchRoute = useMatchRoute()
	const search = useSearch({from: '/(home)'})
	return (
		<>
			<AppBar name="deploy" icon={icon}>
				<nav aria-label="Sections" className="flex items-center gap-1">
					{Array.map(
						[
							{label: 'Apps', to: '/'},
							{label: 'Monitor', to: '/monitor'}
						] as const,
						tab => (
							<Link
								key={tab.to}
								to={tab.to}
								search={search}
								activeOptions={{exact: true}}
								className={buttonVariants({
									variant: Boolean.match(matchRoute({to: tab.to}) !== false, {
										onFalse: () => 'ghost' as const,
										onTrue: () => 'secondary' as const
									})
								})}
							>
								{tab.label}
							</Link>
						)
					)}
				</nav>
			</AppBar>
			<main
				className={`pb-safe mx-auto flex min-h-0 w-full flex-1 flex-col gap-4 overflow-y-auto px-4 py-6 ${Boolean.match(matchRoute({to: '/monitor'}) !== false, {onFalse: () => 'max-w-3xl', onTrue: () => 'max-w-5xl'})}`}
			>
				<Suspense fallback={<Skeleton className="h-7 w-full" />}>
					<Fleet />
				</Suspense>
			</main>
		</>
	)
}

export const Route = createFileRoute('/(home)')({
	component: Shell,
	validateSearch: Schema.decodeUnknownSync(Schema.Struct({machine: Schema.optional(Schema.String)}))
})
