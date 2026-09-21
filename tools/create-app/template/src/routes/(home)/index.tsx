import {useAtomSuspense} from '@effect/atom-react'

import {createFileRoute} from '@tanstack/react-router'

import {RpcClient} from '#lib/utils.ts'

export const Route = createFileRoute('/(home)/')({component: Home})

// oxlint-disable-next-line @deslop/workflow/no-trivial-indirection -- The named component owns the React hook boundary.
function Home() {
	return useAtomSuspense(RpcClient.query('app.name', undefined)).value
}
