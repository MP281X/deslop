import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, X} from 'lucide-react'

import {Button} from '@deslop/components-web/ui/button'
import {Item, ItemActions, ItemContent, ItemDescription, ItemTitle} from '@deslop/components-web/ui/item'

import {decideResourceAtom, resourcesAtom} from '#lib/utils.ts'

function Resources() {
	const rows = useAtomSuspense(resourcesAtom).value
	const [result, decide] = useAtom(decideResourceAtom)
	return (
		<section aria-label="Resource registrations" className="flex flex-col gap-2">
			<h1 className="text-sm font-semibold">Protected resources</h1>
			{Option.match(AsyncResult.error(result), {
				onNone: () => null,
				onSome: error => (
					<p role="alert" className="text-destructive text-xs">
						{error.message}
					</p>
				)
			})}
			{Array.map(rows, row => (
				<Item key={row.id} size="sm">
					<ItemContent>
						<ItemTitle>{row.name}</ItemTitle>
						<ItemDescription className="font-mono wrap-anywhere">{row.resource}</ItemDescription>
						<ItemDescription>{row.status}</ItemDescription>
					</ItemContent>
					<ItemActions>
						{row.status !== 'approved' && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={`Approve ${row.resource}`}
								disabled={AsyncResult.isWaiting(result)}
								onClick={() => decide({approve: true, id: row.id})}
							>
								<Check />
							</Button>
						)}
						{row.status !== 'denied' && (
							<Button
								size="icon-sm"
								variant="ghost"
								aria-label={`Deny ${row.resource}`}
								disabled={AsyncResult.isWaiting(result)}
								onClick={() => decide({approve: false, id: row.id})}
							>
								<X />
							</Button>
						)}
					</ItemActions>
				</Item>
			))}
			{Array.isReadonlyArrayEmpty(rows) && (
				<p className="text-muted-foreground text-xs">No app has requested registration.</p>
			)}
		</section>
	)
}

export const Route = createFileRoute('/(home)/resources')({component: Resources})
