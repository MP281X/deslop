import {useAtom, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, Order} from 'effect'

import {ShieldIcon, UsersIcon} from '@phosphor-icons/react'
import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {ResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'

import {AccountAvatar, PeopleRowsSkeleton} from '#lib/components.tsx'
import {accountAtom, admitAtom, dayLabel, peopleAtom, selectedRowAtom} from '#lib/utils.ts'
import type {Person} from '#services/people/schema.ts'

// The row's own line, then its failed answer beneath it; its actions sit at its end.
function PersonRow(props: {
	children?: ReactNode
	failure: Option.Option<string>
	footer?: ReactNode
	onSelect: () => void
	person: Person
	selected: boolean
}) {
	return (
		<div role="listitem">
			<Item
				size="row"
				id={`person-${props.person.id}`}
				tabIndex={0}
				data-selected={props.selected}
				onFocus={props.onSelect}
			>
				<ItemMedia>
					<AccountAvatar id={props.person.id} name={props.person.name} small />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>
						{props.person.fullName ?? props.person.name}
						{props.person.role === 'Admin' && (
							<ShieldIcon role="img" aria-label="Admin" className="text-primary size-4 shrink-0" />
						)}
					</ItemTitle>
					{Option.match(props.failure, {
						onNone: () =>
							props.person.fullName !== undefined && <ItemDescription>@{props.person.name}</ItemDescription>,
						onSome: message => <ItemDescription>{message}</ItemDescription>
					})}
				</ItemContent>
				{props.children}
			</Item>
			{props.footer}
		</div>
	)
}

// judge-ignore no-repeated-text-action -- apps/auth/AGENTS.md requires Allow and Decline on each access-request row.
function AskingRow(props: {onSelect: () => void; person: Person; selected: boolean}) {
	const [admit, answer] = useAtom(admitAtom(props.person.id))
	return (
		<PersonRow
			person={props.person}
			selected={props.selected}
			onSelect={props.onSelect}
			failure={Option.none()}
			footer={<ResultError result={admit} className="mb-2 ml-9" />}
		>
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
				{dayLabel(props.since)}
			</span>
		</ItemActions>
	)
}

function MemberRow(props: {onSelect: () => void; person: Person; selected: boolean}) {
	return (
		<PersonRow person={props.person} selected={props.selected} onSelect={props.onSelect} failure={Option.none()}>
			<Since since={props.person.since} />
		</PersonRow>
	)
}

// One card: whoever is asking for access first, then everyone with it.
function Directory() {
	const selected = useAtomValue(selectedRowAtom)
	const setSelected = useAtomSet(selectedRowAtom)
	return (
		<>
			<h1 className="sr-only">People</h1>
			{Array.match(
				Array.sort(
					useAtomSuspense(peopleAtom).value,
					Order.mapInput(Order.Boolean, (person: Person) => person.role !== 'Waiting')
				),
				{
					onEmpty: () => <EmptyState label="No one yet" icon={<UsersIcon className="size-5" weight="light" />} />,
					onNonEmpty: rows => (
						<Card size="list">
							<div role="list" aria-label="People">
								{Array.map(rows, person =>
									Boolean.match(person.role === 'Waiting', {
										onFalse: () => (
											<MemberRow
												key={person.id}
												person={person}
												selected={Option.contains(selected, `person-${person.id}`)}
												onSelect={() => setSelected(Option.some(`person-${person.id}`))}
											/>
										),
										onTrue: () => (
											<AskingRow
												key={person.id}
												person={person}
												selected={Option.contains(selected, `person-${person.id}`)}
												onSelect={() => setSelected(Option.some(`person-${person.id}`))}
											/>
										)
									})
								)}
							</div>
						</Card>
					)
				}
			)}
		</>
	)
}

function PeopleRoute() {
	if (!Option.exists(useAtomSuspense(accountAtom).value, signed => signed.role === 'Admin')) return <Navigate to="/" />
	return (
		<Suspense fallback={<PeopleRowsSkeleton label="People" rows={3} />}>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/people')({component: PeopleRoute})
