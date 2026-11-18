import {createFileRoute} from '@tanstack/react-router'
import {Suspense} from 'react'

import {Loaded} from '@deslop/components-web/blocks/states'
import {preload} from '@deslop/components-web/lib/router'
import {AppBar} from '@deslop/components-web/shell/app-bar'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {nameAtom} from '#lib/client.ts'
import icon from '#routes/icon.svg'

// Every RPC requires a signed-in admin: the gate sends a signed-out visitor to Auth, which returns here.
function HomeRoute() {
	// The loader's read usually arrives with the page; a slower one suspends to this skeleton, which React keeps at least 300ms, so it never blinks.
	return (
		<>
			<AppBar icon={icon} name="template-app" />
			<Suspense fallback={<Skeleton className="h-5 w-32" />}>
				<Loaded atom={nameAtom}>{name => name}</Loaded>
			</Suspense>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({
	component: HomeRoute,
	loader: load => preload(load, [nameAtom])
})
