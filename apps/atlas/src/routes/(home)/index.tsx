import {useAtomSuspense} from '@effect/atom-react'

import {Cause, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {Error, SignIn} from '@deslop/components-web/fallbacks'
import {Skeleton} from '@deslop/components-web/ui/skeleton'
import {signInUrl} from '@deslop/runtime/auth/utils'

import {snapshotAtom} from '#lib/utils.ts'

// The views replace this shell; it keeps the app's route compiling while they are built.
function FetchedAt() {
	const snapshot = useAtomSuspense(snapshotAtom, {includeFailure: true})
	if (AsyncResult.isSuccess(snapshot)) return <span>{snapshot.value.fetchedAt}</span>
	if (!Option.exists(Cause.findErrorOption(snapshot.cause), error => error._tag === 'AuthError')) {
		return <Error error={Cause.squash(snapshot.cause)} reset={() => location.reload()} />
	}
	return <SignIn href={signInUrl(location.href)} />
}

function Home() {
	return (
		<Suspense fallback={<Skeleton className="h-5 w-32" />}>
			<FetchedAt />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/')({component: Home})
