import {mountRouter} from '@deslop/components-web/lib/router'

import {routeTree} from './routeTree.gen.ts'

import {Search} from '#lib/auth.ts'

const router = mountRouter(routeTree, Search)

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}
