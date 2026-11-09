import {CatchBoundary, Outlet, createFileRoute, useLocation} from '@tanstack/react-router'

import {PageError} from '#routes/(home)/-error.tsx'
import {ExposeDialog} from '#routes/(home)/-expose.tsx'

// A new view clears a page failure.
function Shell() {
	const href = useLocation({select: location => location.href})
	return (
		<>
			<ExposeDialog />
			<CatchBoundary getResetKey={() => href} errorComponent={PageError}>
				<Outlet />
			</CatchBoundary>
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: Shell})
