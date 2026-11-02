import {CatchBoundary, Outlet, createFileRoute} from '@tanstack/react-router'
import {Suspense} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {PageError} from '#routes/(home)/-error.tsx'
import {ExposeDialog} from '#routes/(home)/-expose.tsx'
import icon from '#routes/icon.svg'

// The bar's field filters the apps; a port opens its Expose dialog from its badge on the row.
function Shell() {
	return (
		<>
			<AppBar name="deploy" icon={icon} commands={[]} />
			<ExposeDialog />
			<main className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col overflow-hidden px-4 pt-3">
				<CatchBoundary getResetKey={() => location.href} errorComponent={PageError}>
					<Suspense fallback={<Skeleton className="h-64 w-full" />}>
						<Outlet />
					</Suspense>
				</CatchBoundary>
			</main>
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: Shell})
