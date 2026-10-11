import {Outlet, createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/(home)')({component: HomeLayout})

// oxlint-disable-next-line @deslop/coding-standards/no-trivial-indirection -- The named layout is the retained home route seam.
function HomeLayout() {
	return <Outlet />
}
