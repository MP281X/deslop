import './styles.css'

import {createRootRouteWithContext} from '@tanstack/react-router'

import type {RouterContext} from '@deslop/components-web/lib/router'

export const Route = createRootRouteWithContext<RouterContext>()({
	shellComponent: props => (
		<div className="bg-background text-foreground pt-safe-top pr-safe-right pl-safe-left flex h-dvh w-dvw flex-col">
			{props.children}
		</div>
	)
})
