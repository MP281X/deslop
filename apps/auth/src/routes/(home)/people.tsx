import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Function, Option} from 'effect'

import {ShieldIcon, UsersIcon} from '@phosphor-icons/react'
import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {AccountAvatar} from '@deslop/components-web/app-bar'
import {EmptyState, Loaded} from '@deslop/components-web/fallbacks'
import {ItemResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {
	Item,
	ItemActions,
	ItemContent,
	ItemDescription,
	ItemGroup,
	ItemMedia,
	ItemTitle
} from '@deslop/components-web/ui/item'
import {monthOf} from '@deslop/runtime/shared/format'

import {accountAtom, admitAtom, peopleAtom} from '#lib/auth.ts'
import {ListCard, PeopleRowsSkeleton} from '#lib/components.tsx'
import type {Person} from '#services/people/schema.ts'

// The row's own line, its actions at its end, then its failed answer beneath it.
function PersonRow(props: {children?: ReactNode; person: Person; variant?: 'outline'}) {
	return (
		<Item role="listitem" size="sm" variant={props.variant}>
			<ItemMedia>
				<AccountAvatar account={props.person} size="default" />
			</ItemMedia>
			<ItemContent>
				<ItemTitle>
					{Option.getOrElse(props.person.fullName, () => props.person.name)}
					{props.person.role === 'Admin' && <ShieldIcon role="img" aria-label="Admin" className="text-primary" />}
				</ItemTitle>
				{Option.isSome(props.person.fullName) && <ItemDescription>@{props.person.name}</ItemDescription>}
			</ItemContent>
			{props.children}
		</Item>
	)
}

// A request for access is answered like a sign-in's code: Deny or Approve, each named for the person.
function AskingRow(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom(props.person.id))
	return (
		<PersonRow person={props.person} variant="outline">
			<ItemActions>
				<Button
					variant="outline"
					disabled={AsyncResult.isWaiting(admit)}
					aria-label={`Deny @${props.person.name}`}
					onClick={() => answer(false)}
				>
					Deny
				</Button>
				<Button
					disabled={AsyncResult.isWaiting(admit)}
					aria-label={`Approve @${props.person.name}`}
					onClick={() => answer(true)}
				>
					Approve
				</Button>
			</ItemActions>
			<ItemResultError result={admit} />
		</PersonRow>
	)
}

// A member's row ends with the month they joined.
function Since(props: {since: Person['since']}) {
	return (
		<ItemActions>
			<span className="text-muted-foreground tabular-nums">
				{Option.match(props.since, {onNone: Function.constNull, onSome: monthOf})}
			</span>
		</ItemActions>
	)
}

function MemberRow(props: {person: Person}) {
	return (
		<PersonRow person={props.person}>
			<Since since={props.person.since} />
		</PersonRow>
	)
}

// One card: whoever is asking for access first, then everyone with it.
function Directory() {
	return (
		<Loaded atom={peopleAtom}>
			{rows => (
				<>
					<h1 className="sr-only">People</h1>
					{Array.match(rows, {
						onEmpty: () => <EmptyState label="No one yet" icon={<UsersIcon className="size-5" weight="light" />} />,
						onNonEmpty: entries => (
							<ListCard>
								<ItemGroup aria-label="People">
									{Array.map(entries, person =>
										Boolean.match(person.role === 'Waiting', {
											onFalse: () => <MemberRow key={person.id} person={person} />,
											onTrue: () => <AskingRow key={person.id} person={person} />
										})
									)}
								</ItemGroup>
							</ListCard>
						)
					})}
				</>
			)}
		</Loaded>
	)
}

function PeopleRoute() {
	if (!Option.exists(useAtomSuspense(accountAtom).value, signed => signed.role === 'Admin')) return <Navigate to="/" />
	return (
		<Suspense fallback={<PeopleRowsSkeleton />}>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/people')({component: PeopleRoute})
