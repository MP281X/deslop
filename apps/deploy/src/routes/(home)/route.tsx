import {Outlet, createFileRoute} from '@tanstack/react-router'

import {ExposeDialog} from '#routes/(home)/-expose.tsx'

function Shell() {
	return (
		<>
			<ExposeDialog />
			<Outlet />
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: Shell})
