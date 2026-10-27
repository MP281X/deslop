import './styles.css'

import {HeadContent, Scripts, createRootRoute} from '@tanstack/react-router'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground flex h-dvh w-dvw flex-col print:h-auto print:w-auto">
			<HeadContent />
			<Scripts />

			{props.children}
		</div>
	)
})
