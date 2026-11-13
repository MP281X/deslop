import {mountRouter} from '@deslop/components-web/router'

import {routeTree} from './routeTree.gen.ts'

const router = mountRouter(routeTree)

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}
