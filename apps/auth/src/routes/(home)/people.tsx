import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order, String} from 'effect'

import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {useCommandQuery} from '@deslop/components-web/app-bar'
import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {FieldError} from '@deslop/components-web/ui/field'

import {AccountAvatar} from '#lib/components.tsx'
import {accountAtom, admitAtom, dayLabel, peopleAtom, removeAtom} from '#lib/utils.ts'
import type {Person} from '#services/people/schema.ts'

// Picture, name, then the GitHub handle, which stays since anyone can set the name before it.
function Identity(props: {person: Person}) {
	return (
		<>
			<AccountAvatar id={props.person.id} name={props.person.name} />
			<span className="min-w-0 truncate font-medium">{props.person.fullName ?? props.person.name}</span>
			<span className="text-muted-foreground min-w-0 flex-1 truncate font-mono text-xs">
				{props.person.fullName !== undefined && `@${props.person.name}`}
			</span>
		</>
	)
}

function PersonRow(props: {children: ReactNode; person: Person}) {
	return (
		<div role="listitem" className="flex h-10 min-w-0 items-center gap-3 border-b px-1 text-sm">
			<Identity person={props.person} />
			{props.children}
		</div>
	)
}

// Someone asking for access leads the list, with the answer on the row.
function AskingRow(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom)
	return (
		<PersonRow person={props.person}>
			<span className="text-muted-foreground shrink-0 font-mono text-xs max-sm:hidden">
				{dayLabel(props.person.since)}
			</span>
			<Button
				size="sm"
				className="shrink-0"
				disabled={AsyncResult.isWaiting(admit)}
				onClick={() => answer({allow: true, id: props.person.id})}
			>
				Allow
			</Button>
			<Button
				size="sm"
				variant="outline"
				className="shrink-0"
				disabled={AsyncResult.isWaiting(admit)}
				onClick={() => answer({allow: false, id: props.person.id})}
			>
				Decline
			</Button>
		</PersonRow>
	)
}

// An admin is marked as one; a member shows since when, and right-click or long-press removes them.
function MemberRow(props: {person: Person}) {
	const [removal, remove] = useAtom(removeAtom)
	if (props.person.role === 'Admin') {
		return (
			<PersonRow person={props.person}>
				<Badge variant="outline" className="shrink-0">
					admin
				</Badge>
			</PersonRow>
		)
	}
	return (
		<ContextMenu>
			<div role="listitem">
				<ContextMenuTrigger
					render={
						<div
							role="button"
							tabIndex={0}
							aria-haspopup="menu"
							aria-label={`${props.person.fullName ?? props.person.name}, member since ${dayLabel(props.person.since)}`}
							className="hover:bg-muted/50 flex h-10 min-w-0 items-center gap-3 border-b px-1 text-sm"
						/>
					}
				>
					<Identity person={props.person} />
					<span className="text-muted-foreground shrink-0 font-mono text-xs">{dayLabel(props.person.since)}</span>
				</ContextMenuTrigger>
			</div>
			<ContextMenuContent className="w-auto min-w-36">
				<ContextMenuItem
					variant="destructive"
					disabled={AsyncResult.isWaiting(removal)}
					onClick={() => remove(props.person.id)}
				>
					Remove
				</ContextMenuItem>
			</ContextMenuContent>
		</ContextMenu>
	)
}

// One list: whoever is asking for access first, then everyone with it.
function Directory() {
	const query = useCommandQuery()
	const people = Array.filter(
		Array.sort(
			useAtomSuspense(peopleAtom).value,
			Order.mapInput(Order.Boolean, (person: Person) => person.role !== 'Waiting')
		),
		person => String.includes(query)(String.toLowerCase(`${person.fullName ?? ''} ${person.name}`))
	)
	const [admit] = useAtom(admitAtom)
	const [removal] = useAtom(removeAtom)
	return (
		<>
			{Array.match(people, {
				onEmpty: () => (
					<Empty>
						<EmptyHeader>
							<EmptyTitle>No one matches</EmptyTitle>
						</EmptyHeader>
					</Empty>
				),
				onNonEmpty: rows => (
					<div role="list" aria-label="People">
						{Array.map(rows, person =>
							Boolean.match(person.role === 'Waiting', {
								onFalse: () => <MemberRow key={person.id} person={person} />,
								onTrue: () => <AskingRow key={person.id} person={person} />
							})
						)}
					</div>
				)
			})}
			<FieldError>
				{Option.getOrUndefined(
					Option.map(
						Option.orElse(AsyncResult.error(admit), () => AsyncResult.error(removal)),
						failure => failure.message
					)
				)}
			</FieldError>
		</>
	)
}

// Admins manage people here; anyone else who opens it goes back to their sign-ins.
function PeopleRoute() {
	if (!Option.exists(useAtomSuspense(accountAtom).value, signed => signed.role === 'Admin')) return <Navigate to="/" />
	return (
		<Suspense fallback={<ItemListSkeleton label="People" media rows={3} />}>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/people')({component: PeopleRoute})
