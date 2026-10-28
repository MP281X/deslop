import {useAtomValue} from '@effect/atom-react'

import {Cause, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'

import {Error, Loading} from '@deslop/components-web/fallbacks'
import {buttonVariants} from '@deslop/components-web/ui/button'
import {AUTH_URL} from '@deslop/runtime/auth/utils'

import {RpcClient} from '#lib/utils.ts'

export const Route = createFileRoute('/(home)/')({component: Home})

// Every RPC requires a Deslop sign-in; GitHub returns here once it is done.
function Home() {
	return AsyncResult.match(useAtomValue(RpcClient.query('app.name', undefined)), {
		onFailure: failure => {
			if (!Option.exists(Cause.findErrorOption(failure.cause), error => error._tag === 'AuthError')) {
				return <Error error={Cause.squash(failure.cause)} reset={() => location.reload()} />
			}
			return (
				<div className="flex flex-1 items-center justify-center">
					<a
						className={buttonVariants()}
						href={`${AUTH_URL}/auth/github?${new URLSearchParams({next: location.href})}`}
					>
						Sign in with GitHub
					</a>
				</div>
			)
		},
		onInitial: () => <Loading />,
		onSuccess: name => name.value
	})
}
