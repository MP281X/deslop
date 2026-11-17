import {mountRouter} from '@deslop/components-web/lib/router'

import {routeTree} from './routeTree.gen.ts'

import {Search} from '#routes/(home)/index.tsx'

const router = mountRouter(routeTree, Search)

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}
