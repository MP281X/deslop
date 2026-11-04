import * as WebRuntime from '@deslop/runtime/web'

import {routeTree} from './routeTree.gen.ts'

const app = WebRuntime.makeRouter(routeTree)

declare module '@tanstack/react-router' {
	// oxlint-disable-next-line typescript/consistent-type-definitions -- TanStack Router augments this interface by name.
	interface Register {
		router: typeof app.router
	}
}

WebRuntime.mount(app)
