import {RouterProvider} from '@tanstack/react-router'
import {StrictMode} from 'react'
import {createRoot} from 'react-dom/client'

import * as WebRuntime from '@deslop/runtime/web'

import {routeTree} from './routeTree.gen.ts'

const app = WebRuntime.makeRouter(routeTree)

declare module '@tanstack/react-router' {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack Router augments this interface by name.
	interface Register {
		router: typeof app.router
	}
}

createRoot(app.root).render(
	<StrictMode>
		<RouterProvider router={app.router} />
	</StrictMode>
)
