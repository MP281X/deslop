import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order} from 'effect'

import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'
import type {ReactNode} from 'react'

import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {ResultError} from '@deslop/components-web/result-error'
import {Badge} from '@deslop/components-web/ui/badge'
import {Button} from '@deslop/components-web/ui/button'
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger
} from '@deslop/components-web/ui/context-menu'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogTitle
} from '@deslop/components-web/ui/dialog'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'

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

// The row's own line, then its failed answer or removal beneath it.
function PersonRow(props: {children: ReactNode; failure?: ReactNode; person: Person}) {
	return (
		<div role="listitem" id={`person-${props.person.id}`} className="border-b">
			<div className="flex h-8 min-w-0 items-center gap-3 px-1 text-sm max-sm:h-11">
				<Identity person={props.person} />
				{props.children}
			</div>
			{props.failure}
		</div>
	)
}

// Someone asking for access leads the list, with the answer on the row.
function AskingRow(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom(props.person.id))
	return (
		<PersonRow person={props.person} failure={<ResultError result={admit} className="mr-1 mb-2 ml-10 wrap-anywhere" />}>
			<span className="text-muted-foreground shrink-0 font-mono text-xs max-sm:hidden">
				{dayLabel(props.person.since)}
			</span>
			<Button
				size="sm"
				className="shrink-0 max-sm:h-11"
				disabled={AsyncResult.isWaiting(admit)}
				onClick={() => answer(true)}
			>
				Allow
			</Button>
			<Button
				size="sm"
				variant="outline"
				className="shrink-0 max-sm:h-11"
				disabled={AsyncResult.isWaiting(admit)}
				onClick={() => answer(false)}
			>
				Decline
			</Button>
		</PersonRow>
	)
}

// An admin is marked as one; a member shows since when, and right-click or long-press removes them after a confirmation.
function MemberRow(props: {person: Person}) {
	const [removal, remove] = useAtom(removeAtom(props.person.id))
	const [confirm, setConfirm] = useState(false)
	if (props.person.role === 'Admin') {
		return (
			<PersonRow person={props.person}>
				<Badge variant="outline" className="shrink-0">
					admin
				</Badge>
			</PersonRow>
		)
	}
	const name = props.person.fullName ?? props.person.name
	return (
		<ContextMenu>
			<div role="listitem" id={`person-${props.person.id}`} className="border-b">
				<ContextMenuTrigger
					render={
						<div
							role="button"
							tabIndex={0}
							aria-haspopup="menu"
							aria-label={`${name}, member since ${dayLabel(props.person.since)}`}
							className="hover:bg-muted/50 flex h-8 min-w-0 items-center gap-3 px-1 text-sm max-sm:h-11"
						/>
					}
				>
					<Identity person={props.person} />
					<span className="text-muted-foreground shrink-0 font-mono text-xs">{dayLabel(props.person.since)}</span>
				</ContextMenuTrigger>
				<ResultError result={removal} className="mr-1 mb-2 ml-10 wrap-anywhere" />
			</div>
			<ContextMenuContent className="w-auto min-w-36">
				<ContextMenuItem
					variant="destructive"
					disabled={AsyncResult.isWaiting(removal)}
					onClick={() => setConfirm(true)}
				>
					Remove
				</ContextMenuItem>
			</ContextMenuContent>
			<Dialog open={confirm} onOpenChange={setConfirm}>
				<DialogContent>
					<DialogTitle>Remove {name}?</DialogTitle>
					<DialogDescription>
						They will no longer be able to sign in to any Deslop app, and their sign-ins end.
					</DialogDescription>
					<ResultError result={removal} />
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" disabled={AsyncResult.isWaiting(removal)} />}>
							Cancel
						</DialogClose>
						<Button variant="destructive" disabled={AsyncResult.isWaiting(removal)} onClick={() => remove()}>
							Remove
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</ContextMenu>
	)
}

// One list: whoever is asking for access first, then everyone with it.
function Directory() {
	return Array.match(
		Array.sort(
			useAtomSuspense(peopleAtom).value,
			Order.mapInput(Order.Boolean, (person: Person) => person.role !== 'Waiting')
		),
		{
			onEmpty: () => (
				<Empty>
					<EmptyHeader>
						<EmptyTitle>No one yet</EmptyTitle>
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
		}
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
