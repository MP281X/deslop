import './styles.css'

import {HeadContent, Scripts, createRootRoute} from '@tanstack/react-router'

import {AppBar} from '@deslop/components-web/app-bar'

import icon from './icon-dark.png'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground flex h-dvh w-dvw flex-col">
			<HeadContent />
			<Scripts />

			<AppBar icon={icon} name="gateway" />
			{props.children}
		</div>
	)
})
