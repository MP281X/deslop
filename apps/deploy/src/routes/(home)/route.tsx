import {CatchBoundary, Outlet, createFileRoute, useLocation} from '@tanstack/react-router'

import {PageError} from '#routes/(home)/-error.tsx'
import {ExposeDialog} from '#routes/(home)/-expose.tsx'

// The page owns the whole screen: its bar, machine split and panes; a new view clears a page failure.
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
