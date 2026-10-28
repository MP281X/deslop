import {Outlet, createFileRoute} from '@tanstack/react-router'

function HomeLayout() {
	return <Outlet />
}

export const Route = createFileRoute('/(home)')({component: HomeLayout})
