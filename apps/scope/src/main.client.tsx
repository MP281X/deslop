import {mount} from '@deslop/components-web/router'

import {routeTree} from './routeTree.gen.ts'

const router = mount(routeTree)

declare module '@tanstack/react-router' {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack Router augments this interface by name.
	interface Register {
		router: typeof router
	}
}
