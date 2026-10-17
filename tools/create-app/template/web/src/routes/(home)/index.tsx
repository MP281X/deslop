import {useAtomSuspense} from '@effect/atom-react'

import {createFileRoute} from '@tanstack/react-router'

import {RpcClient} from '#lib/utils.ts'

export const Route = createFileRoute('/(home)/')({component: Home})

function Home() {
	return useAtomSuspense(RpcClient.query('app.name', undefined)).value
}
