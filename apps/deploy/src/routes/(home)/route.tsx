import {useAtomValue} from '@effect/atom-react'

import {Effect, Function, Option} from 'effect'

import {Outlet, createFileRoute} from '@tanstack/react-router'
import {AsyncResult, Atom} from 'effect/reactivity'

// The dialog is its own chunk, fetched after the page's so the page parses without it, and stays mounted once loaded so it closes with its animation.
const exposeModuleAtom = Atom.make(Effect.promise(() => import('#routes/(home)/-expose.tsx')))

function ShellRoute() {
	return (
		<>
			{Option.match(AsyncResult.value(useAtomValue(exposeModuleAtom)), {
				onNone: Function.constNull,
				onSome: module => <module.ExposeDialog />
			})}
			<Outlet />
		</>
	)
}

export const Route = createFileRoute('/(home)')({component: ShellRoute})
