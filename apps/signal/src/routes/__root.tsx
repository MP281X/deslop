import './styles.css'

import {HeadContent, Scripts, createRootRoute} from '@tanstack/react-router'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground pt-safe-top pr-safe-right pl-safe-left flex h-dvh w-dvw flex-col">
			<HeadContent />
			<Scripts />

			{props.children}
		</div>
	)
})
