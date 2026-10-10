import {RegistryProvider} from '@effect/atom-react'

import {registerRootComponent} from 'expo'

import {RootRoute} from '#routes/__root.tsx'

registerRootComponent(() => (
	<RegistryProvider>
		<RootRoute />
	</RegistryProvider>
))
