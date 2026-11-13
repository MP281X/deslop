import {createFileRoute} from '@tanstack/react-router'
import {Suspense} from 'react'

import {Loaded} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {RpcClient} from '#lib/client.ts'

// Every RPC requires a user: the gate sends a signed-out visitor to Auth, which returns here.
function HomeRoute() {
	// The first load suspends to a skeleton; React keeps a shown fallback at least 300ms, so it never blinks.
	return (
		<Suspense fallback={<Skeleton className="h-5 w-32" />}>
			<Loaded atom={RpcClient.query('app.name', undefined)}>{name => name}</Loaded>
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/')({component: HomeRoute})
