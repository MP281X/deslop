import {createFileRoute} from '@tanstack/react-router'
import {Suspense} from 'react'

import {AppBar} from '@deslop/components-web/app-bar'
import {Loaded} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {nameAtom} from '#lib/client.ts'
import icon from '#routes/icon.svg'

// Every RPC requires a user: the gate sends a signed-out visitor to Auth, which returns here.
function HomeRoute() {
	// The first load suspends to a skeleton; React keeps a shown fallback at least 300ms, so it never blinks.
	return (
		<>
			<AppBar icon={icon} name="template-app" />
			<Suspense fallback={<Skeleton className="h-5 w-32" />}>
				<Loaded atom={nameAtom}>{name => name}</Loaded>
			</Suspense>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: HomeRoute})
