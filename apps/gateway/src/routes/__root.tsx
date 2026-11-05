import './styles.css'

import {HeadContent, Scripts, createRootRoute} from '@tanstack/react-router'

import {Toaster} from '@deslop/components-web/ui/toast'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground pt-safe-top pr-safe-right pl-safe-left flex h-dvh w-dvw flex-col">
			<HeadContent />
			<Scripts />

			<Toaster>{props.children}</Toaster>
		</div>
	)
})
