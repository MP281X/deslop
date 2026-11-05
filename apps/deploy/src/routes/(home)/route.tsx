import {CatchBoundary, Outlet, createFileRoute} from '@tanstack/react-router'

import {PageError} from '#routes/(home)/-error.tsx'
import {ExposeDialog} from '#routes/(home)/-expose.tsx'

// The page owns the whole screen: its bar, machine split and panes.
function Shell() {
	return (
		<>
			<ExposeDialog />
			<CatchBoundary getResetKey={() => location.href} errorComponent={PageError}>
				<Outlet />
			</CatchBoundary>
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: Shell})
