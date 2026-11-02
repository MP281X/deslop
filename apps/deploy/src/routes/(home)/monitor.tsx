import {createFileRoute, redirect} from '@tanstack/react-router'

// Monitor merged into the one page; old bookmarks and installed start URLs land there.
export const Route = createFileRoute('/(home)/monitor')({
	beforeLoad: () => {
		throw redirect({replace: true, to: '/'})
	}
})
