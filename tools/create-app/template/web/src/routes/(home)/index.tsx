import {useAtomSuspense} from '@effect/atom-react'

import {Cause, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {RpcClient} from '#lib/utils.ts'

// Every RPC requires a Deslop sign-in; GitHub returns here once it is done.
function Name() {
	const name = useAtomSuspense(RpcClient.query('app.name', undefined), {includeFailure: true})
	if (AsyncResult.isSuccess(name)) return name.value
	if (!Option.exists(Cause.findErrorOption(name.cause), error => error._tag === 'AuthError')) {
		return <Error error={Cause.squash(name.cause)} reset={() => location.reload()} />
	}
	return <SignIn href={signInUrl(location.href)} />
}

// The first load suspends to a skeleton; React keeps a shown fallback at least 300ms, so it never blinks.
function Home() {
	return (
		<Suspense fallback={<Skeleton className="h-5 w-32" />}>
			<Name />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
