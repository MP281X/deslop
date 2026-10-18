import {Outlet, createFileRoute} from '@tanstack/react-router'

export const Route = createFileRoute('/(home)')({component: HomeLayout})

function HomeLayout() {
	return <Outlet />
}
