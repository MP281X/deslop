import {useAtomValue} from '@effect/atom-react'

import {Cause, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'

import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {RpcClient} from '#lib/utils.ts'

// Every RPC requires a Deslop sign-in; GitHub returns here once it is done.
function Home() {
	return AsyncResult.match(useAtomValue(RpcClient.query('app.name', undefined)), {
		onFailure: failure => {
			if (!Option.exists(Cause.findErrorOption(failure.cause), error => error._tag === 'AuthError')) {
				return <Error error={Cause.squash(failure.cause)} reset={() => location.reload()} />
			}
			return <SignIn href={signInUrl(location.href)} />
		},
		onInitial: () => <Skeleton className="h-5 w-32" />,
		onSuccess: name => name.value
	})
}

export const Route = createFileRoute('/(home)/')({component: Home})
