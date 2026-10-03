import './styles.css'

import {HeadContent, Scripts, createRootRoute} from '@tanstack/react-router'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground flex min-h-dvh flex-col">
			<HeadContent />
			<Scripts />

			{props.children}
		</div>
	)
})
