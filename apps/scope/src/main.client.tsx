import {RouterProvider} from '@tanstack/react-router'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import * as WebRuntime from '@deslop/runtime/web'

import {routeTree} from './routeTree.gen.ts'

const {root, router} = WebRuntime.makeRouter(routeTree)

router.update({
	getScrollRestorationKey: location => {
		const search = new URLSearchParams(location.searchStr)
		search.delete('trace')
		return `${location.pathname}?${search.toString()}`
	}
})

declare module '@tanstack/react-router' {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack Router augments this interface by name.
	interface Register {
		router: typeof router
	}
}

createRoot(root).render(
	<StrictMode>
		<RouterProvider router={router} />
	</StrictMode>
)
