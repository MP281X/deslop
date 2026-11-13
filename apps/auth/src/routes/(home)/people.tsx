import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, DateTime, Option, pipe} from 'effect'

import {ShieldIcon, UsersIcon} from '@phosphor-icons/react'
import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {EmptyState, Loaded} from '@deslop/components-web/fallbacks'
import {ResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'

import {AccountAvatar, PeopleRowsSkeleton} from '#lib/components.tsx'
import {accountAtom, admitAtom, peopleAtom} from '#lib/utils.ts'
import type {Person} from '#services/people/schema.ts'

// The row's own line, then its failed answer beneath it; its actions sit at its end.
function PersonRow(props: {children?: ReactNode; footer?: ReactNode; person: Person}) {
	return (
		<div role="listitem">
			<Item size="row">
				<ItemMedia>
					<AccountAvatar id={props.person.id} name={props.person.name} small />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{props.person.fullName ?? props.person.name}</ItemTitle>
					{props.person.fullName !== undefined && <ItemDescription>@{props.person.name}</ItemDescription>}
					{props.person.role === 'Admin' && (
						<ShieldIcon role="img" aria-label="Admin" className="text-primary size-4 shrink-0 self-center" />
					)}
				</ItemContent>
				{props.children}
			</Item>
			{props.footer}
		</div>
	)
}

// judge-ignore no-repeated-text-action -- apps/auth/AGENTS.md requires Allow and Decline on each access-request row.
function AskingRow(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom(props.person.id))
	return (
		<PersonRow person={props.person} footer={<ResultError result={admit} className="mb-2 ml-9" />}>
			<ItemActions>
				<Button variant="outline" size="xs" disabled={AsyncResult.isWaiting(admit)} onClick={() => answer(false)}>
					Decline
				</Button>
				<Button size="xs" disabled={AsyncResult.isWaiting(admit)} onClick={() => answer(true)}>
					Allow
				</Button>
			</ItemActions>
		</PersonRow>
	)
}

// Every row ends with the same since-date column, wide enough for "Nov 2026" on one line.
function Since(props: {since: number}) {
	return (
		<ItemActions>
			<span className="text-muted-foreground w-16 shrink-0 text-right font-mono text-xs whitespace-nowrap tabular-nums">
				{pipe(DateTime.makeUnsafe(props.since), DateTime.formatLocal({month: 'short', year: 'numeric'}))}
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
							<Card size="list">
								<div role="list" aria-label="People">
									{Array.map(entries, person =>
										Boolean.match(person.role === 'Waiting', {
											onFalse: () => <MemberRow key={person.id} person={person} />,
											onTrue: () => <AskingRow key={person.id} person={person} />
										})
									)}
								</div>
							</Card>
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
