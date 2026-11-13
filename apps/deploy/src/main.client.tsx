import {defaultStringifySearch} from '@tanstack/react-router'

import {mountRouter} from '@deslop/components-web/router'
import {searchSerializerOf} from '@deslop/runtime/web/search'

import {routeTree} from './routeTree.gen.ts'

import {Search} from '#routes/(home)/index.tsx'

const router = mountRouter(routeTree)
router.update({...router.options, stringifySearch: searchSerializerOf(Search, defaultStringifySearch)})

declare module '@tanstack/react-router' {
	interface Register {
		router: typeof router
	}
}
