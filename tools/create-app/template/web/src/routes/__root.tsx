import './styles.css'

import {createRootRoute} from '@tanstack/react-router'

import {AppBar} from '@deslop/components-web/app-bar'

import icon from './icon.svg'

export const Route = createRootRoute({
	shellComponent: props => (
		<div className="bg-background text-foreground pt-safe-top pr-safe-right pl-safe-left flex h-dvh w-dvw flex-col">
			<AppBar icon={icon} name="template-app" />
			{props.children}
		</div>
	)
})
