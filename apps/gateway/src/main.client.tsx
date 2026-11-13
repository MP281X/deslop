import {mountRouter} from '@deslop/components-web/router'

import {routeTree} from './routeTree.gen.ts'

import {searchStringOf} from '#lib/search.ts'

const router = mountRouter(routeTree)
router.update({...router.options, stringifySearch: searchStringOf})

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}
