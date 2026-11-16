import {useAtomValue} from '@effect/atom-react'

import {Function, Option} from 'effect'

import {Outlet, createFileRoute} from '@tanstack/react-router'
import {Suspense, lazy} from 'react'

import {exposeTargetAtom} from '#lib/fleet.ts'

// The dialog's code loads the first time a port's expose opens.
const ExposeDialog = lazy(async () => {
	const {ExposeDialog: dialog} = await import('#routes/(home)/-expose.tsx')
	return {default: dialog}
})

function ShellRoute() {
	const target = useAtomValue(exposeTargetAtom)
	return (
		<>
			{Option.match(target, {
				onNone: Function.constNull,
				onSome: () => (
					<Suspense fallback={null}>
						<ExposeDialog />
					</Suspense>
				)
			})}
			<Outlet />
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: ShellRoute})
