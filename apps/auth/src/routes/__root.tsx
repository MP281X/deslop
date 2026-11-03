import './styles.css'

import {HeadContent, Scripts, createRootRoute} from '@tanstack/react-router'

import {Toaster} from '@deslop/components-web/ui/toast'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground safe-area flex h-dvh w-dvw flex-col">
			<HeadContent />
			<Scripts />

			<Toaster>{props.children}</Toaster>
		</div>
	)
})
