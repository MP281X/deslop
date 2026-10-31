import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {ItemList, ItemListSkeleton} from '@deslop/components-web/item-list'
import {Button} from '@deslop/components-web/ui/button'
import {FieldError} from '@deslop/components-web/ui/field'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'

import {AccountAvatar} from '#lib/components.tsx'
import {accountAtom, admitAtom, dayLabel, peopleAtom, removeAtom} from '#lib/utils.ts'
import type {Person} from '#services/people/schema.ts'

function PersonItem(props: {actions?: ReactNode; detail: string; person: Person}) {
	return (
		<Item role="listitem">
			<ItemMedia>
				<AccountAvatar id={props.person.id} name={props.person.name} />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>{props.person.fullName ?? props.person.name}</ItemTitle>
				<ItemDescription className="font-mono">
					@{props.person.name} · {props.detail}
				</ItemDescription>
			</ItemContent>
			<ItemActions>{props.actions}</ItemActions>
		</Item>
	)
}

function AskingItem(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom)
	return (
		<PersonItem
			person={props.person}
			detail={dayLabel(props.person.since)}
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
			detail={Boolean.match(props.person.role === 'Admin', {
				onFalse: () => `since ${dayLabel(props.person.since)}`,
				onTrue: () => 'admin'
			})}
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

function People(props: {children: ReactElement[]; label: string; title: string}) {
	return (
		<section className="flex flex-col gap-2">
			<h2 className="text-muted-foreground font-mono text-xs">{props.title}</h2>
			<ItemList label={props.label}>{props.children}</ItemList>
		</section>
	)
}

function Directory() {
	const people = useAtomSuspense(peopleAtom).value
	const asking = Array.filter(people, person => person.role === 'Waiting')
	const members = Array.filter(people, person => person.role !== 'Waiting')
	const [admit] = useAtom(admitAtom)
	const [removal] = useAtom(removeAtom)
	const error = Option.orElse(AsyncResult.error(admit), () => AsyncResult.error(removal))
	return (
		<>
			<h1 className="text-xl font-semibold tracking-tight">People</h1>
			{Array.isArrayNonEmpty(asking) && (
				<People label="Asking for access" title={`${asking.length} asking`}>
					{Array.map(asking, person => (
						<AskingItem key={person.id} person={person} />
					))}
				</People>
			)}
			<People label="With access" title={`${members.length} with access`}>
				{Array.map(members, person => (
					<MemberItem key={person.id} person={person} />
				))}
			</People>
			<FieldError>{Option.getOrUndefined(Option.map(error, failure => failure.message))}</FieldError>
		</>
	)
}

// Admins manage people here; anyone else who opens it goes back to their sign-ins.
function PeopleRoute() {
	if (!Option.exists(useAtomSuspense(accountAtom).value, signed => signed.role === 'Admin')) return <Navigate to="/" />
	return (
		<Suspense
			fallback={
				<>
					<h1 className="text-xl font-semibold tracking-tight">People</h1>
					<ItemListSkeleton label="People" media rows={3} />
				</>
			}
		>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/people')({component: PeopleRoute})
