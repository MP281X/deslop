import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order, String} from 'effect'

import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {useCommandQuery} from '@deslop/components-web/app-bar'
import {ItemList, ItemListSkeleton} from '@deslop/components-web/item-list'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyHeader, EmptyTitle} from '@deslop/components-web/ui/empty'
import {FieldError} from '@deslop/components-web/ui/field'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'

import {AccountAvatar} from '#lib/components.tsx'
import {accountAtom, admitAtom, dayLabel, peopleAtom, removeAtom} from '#lib/utils.ts'
import type {Person} from '#services/people/schema.ts'

function PersonItem(props: {actions?: ReactNode; detail: ReactNode; person: Person}) {
	return (
		<Item role="listitem">
			<ItemMedia>
				<AccountAvatar id={props.person.id} name={props.person.name} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.person.fullName ?? props.person.name}</ItemTitle>
				<ItemDescription>{props.detail}</ItemDescription>
			</ItemContent>
			<ItemActions>{props.actions}</ItemActions>
		</Item>
	)
}

// Someone asking for access leads the list; their GitHub handle stays, since anyone can set the name above it.
function AskingItem(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom)
	return (
		<PersonItem
			person={props.person}
			detail={
				<span className="text-primary font-mono">
					@{props.person.name} · asking since {dayLabel(props.person.since)}
				</span>
			}
			actions={
				<>
					<Button disabled={AsyncResult.isWaiting(admit)} onClick={() => answer({allow: true, id: props.person.id})}>
						Allow
					</Button>
					<Button
						variant="outline"
						disabled={AsyncResult.isWaiting(admit)}
						onClick={() => answer({allow: false, id: props.person.id})}
					>
						Decline
					</Button>
				</>
			}
		/>
	)
}

function MemberItem(props: {person: Person}) {
	const [removal, remove] = useAtom(removeAtom)
	return (
		<PersonItem
			person={props.person}
			detail={
				<span className="font-mono">
					@{props.person.name} ·{' '}
					{Boolean.match(props.person.role === 'Admin', {
						onFalse: () => `since ${dayLabel(props.person.since)}`,
						onTrue: () => 'admin'
					})}
				</span>
			}
			actions={
				props.person.role === 'Member' && (
					<Button variant="outline" disabled={AsyncResult.isWaiting(removal)} onClick={() => remove(props.person.id)}>
						Remove
					</Button>
				)
			}
		/>
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
					<ItemList label="People">
						{Array.map(rows, person =>
							Boolean.match(person.role === 'Waiting', {
								onFalse: () => <MemberItem key={person.id} person={person} />,
								onTrue: () => <AskingItem key={person.id} person={person} />
							})
						)}
					</ItemList>
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
