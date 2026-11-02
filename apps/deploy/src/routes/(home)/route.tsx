import {useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Cause, Option, Schema, String} from 'effect'

import {
	CatchBoundary,
	Link,
	Outlet,
	createFileRoute,
	useMatchRoute,
	useNavigate,
	useSearch
} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'
import {Plus} from 'lucide-react'
import {Suspense} from 'react'

import {AppBar, AppBarAction, AppBarTab} from '@deslop/components-web/app-bar'
import {StatusDot} from '@deslop/components-web/status-dot'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {ToggleGroup, ToggleGroupItem} from '@deslop/components-web/ui/toggle-group'
import {AuthError} from '@deslop/runtime/auth/schema'

import {MachineIcon, machineName} from '#lib/components.tsx'
import {exposeAtom, exposeOpenAtom, inventoryAtom} from '#lib/utils.ts'
import {PageError} from '#routes/(home)/-error.tsx'
import {ExposeDialog} from '#routes/(home)/-expose.tsx'
import icon from '#routes/icon-dark.svg'

function Fleet() {
	const result = useAtomSuspense(inventoryAtom, {includeFailure: true})
	const search = useSearch({from: '/(home)'})
	const navigate = useNavigate({from: '/'})
	const matchRoute = useMatchRoute()
	const available = AsyncResult.value(result)
	if (
		AsyncResult.isFailure(result) &&
		(Option.isNone(available) || Option.exists(Cause.findErrorOption(result.cause), Schema.is(AuthError)))
	) {
		throw Cause.squash(result.cause)
	}
	const snapshot = Option.getOrThrow(available)
	return (
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
			<ToggleGroupItem value="all" aria-label="All machines">
				All
			</ToggleGroupItem>
			{Array.map(snapshot.workers ?? Array.dedupe(Array.map(snapshot.items, item => item.worker)), (worker, index) => {
				const failed =
					AsyncResult.isFailure(result) ||
					Array.some(snapshot.sources, source => source.name === worker && source.error !== '')
				const checking =
					index !== 0 &&
					!failed &&
					!Array.some(snapshot.sources, source => String.startsWith(`${worker} · `)(source.name))
				return (
					<ToggleGroupItem key={worker} value={worker} className="gap-1.5">
						<MachineIcon worker={worker} />
						{machineName(worker)}
						<span
							role="img"
							className="flex items-center justify-center"
							aria-label={Boolean.match(checking, {
								onFalse: () => Boolean.match(failed, {onFalse: () => 'Available', onTrue: () => 'Unavailable'}),
								onTrue: () => 'Checking'
							})}
						>
							<StatusDot
								status={Boolean.match(failed || checking, {onFalse: () => 'live', onTrue: () => 'off'})}
								waiting={checking}
							/>
						</span>
					</ToggleGroupItem>
				)
			})}
		</ToggleGroup>
	)
}

// Apps filter from the bar's field and, once the inventory is in, expose a port from its button; Monitor keeps the bar without either.
function Shell() {
	const matchRoute = useMatchRoute()
	const search = useSearch({from: '/(home)'})
	const setExposing = useAtomSet(exposeOpenAtom)
	const resetExpose = useAtomSet(exposeAtom)
	const loaded = AsyncResult.isSuccess(useAtomValue(inventoryAtom))
	const exposing = matchRoute({to: '/monitor'}) === false && loaded
	function expose() {
		resetExpose(Atom.Reset)
		setExposing(true)
	}
	return (
		<>
			<AppBar
				name="deploy"
				icon={icon}
				tabs={Array.map(
					[
						{label: 'Apps', to: '/'},
						{label: 'Monitor', to: '/monitor'}
					] as const,
					tab => (
						<AppBarTab
							key={tab.to}
							active={matchRoute({to: tab.to}) !== false}
							render={<Link to={tab.to} search={search} activeOptions={{exact: true}} />}
						>
							{tab.label}
						</AppBarTab>
					)
				)}
				commands={Boolean.match(matchRoute({to: '/monitor'}) !== false, {
					onFalse: () => Array.filter([{icon: <Plus />, label: 'Expose a port', run: expose}], () => exposing),
					onTrue: () => undefined
				})}
				action={exposing && <AppBarAction icon={<Plus />} label="Expose" onClick={expose} />}
			/>
			<ExposeDialog />
			<main
				className={`mx-auto flex min-h-0 w-full flex-1 flex-col gap-4 overflow-hidden px-4 pt-3 ${Boolean.match(matchRoute({to: '/monitor'}) !== false, {onFalse: () => 'max-w-3xl', onTrue: () => 'max-w-5xl'})}`}
			>
				<CatchBoundary getResetKey={() => location.href} errorComponent={PageError}>
					<div className="bg-background sticky top-0 z-20 border-b pb-3">
						<Suspense fallback={<Skeleton className="h-7 w-full" />}>
							<Fleet />
						</Suspense>
					</div>
					<Suspense fallback={<Skeleton className="h-64 w-full" />}>
						<Outlet />
					</Suspense>
				</CatchBoundary>
			</main>
		</>
	)
}

export const Route = createFileRoute('/(home)')({
	component: Shell,
	validateSearch: Schema.decodeUnknownSync(Schema.Struct({machine: Schema.optional(Schema.String)}))
})
