import {useAtom, useAtomSet, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, Order} from 'effect'

import {ShieldIcon, TrashIcon, UsersIcon} from '@phosphor-icons/react'
import {Navigate, createFileRoute} from '@tanstack/react-router'
import {useMachineResult} from '@typeonce/effect-machine-react'
import {AtomMachine} from '@typeonce/effect-machine/reactivity'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {EmptyState} from '@deslop/components-web/fallbacks'
import {ResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {Card} from '@deslop/components-web/ui/card'
import {Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle} from '@deslop/components-web/ui/item'
import {UndoButton} from '@deslop/components-web/undo'

import {AccountAvatar, PeopleRowsSkeleton} from '#lib/components.tsx'
import {accountAtom, admitAtom, dayLabel, peopleAtom, removePersonAtom, selectedRowAtom} from '#lib/utils.ts'
import type {Person} from '#services/people/schema.ts'

// The row's own line, then its failed answer beneath it; its actions sit at its end.
function PersonRow(props: {
	children?: ReactNode
	failure: Option.Option<string>
	footer?: ReactNode
	onSelect: () => void
	person: Person
	removed: boolean
	selected: boolean
}) {
	return (
		<div role="listitem">
			<Item
				size="row"
				id={`person-${props.person.id}`}
				tabIndex={0}
				data-removed={props.removed}
				data-selected={props.selected}
				onFocus={props.onSelect}
			>
				<ItemMedia>
					<AccountAvatar id={props.person.id} name={props.person.name} small />
				</ItemMedia>
				<ItemContent>
					<ItemTitle>{props.person.fullName ?? props.person.name}</ItemTitle>
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
			removed={false}
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

// Every person row ends with the same since-date column and one 24px slot, so a shield and a trash share their centre.
function PersonEnd(props: {children?: ReactNode; since: number}) {
	return (
		<ItemActions>
			<span className="text-muted-foreground w-14 shrink-0 text-right font-mono text-xs tabular-nums">
				{dayLabel(props.since)}
			</span>
			<span className="flex size-6 shrink-0 items-center justify-center max-sm:size-11">{props.children}</span>
		</ItemActions>
	)
}

// An admin is marked with a shield in the end slot; a member's trash removes them unless the row is yours.
function MemberRow(props: {
	failure: Option.Option<string>
	onRemove: () => void
	onSelect: () => void
	person: Person
	removable: boolean
	removed: boolean
	selected: boolean
	undo: () => void
}) {
	const name = props.person.fullName ?? props.person.name
	if (props.person.role === 'Admin') {
		return (
			<PersonRow
				person={props.person}
				selected={props.selected}
				onSelect={props.onSelect}
				removed={false}
				failure={Option.none()}
			>
				<PersonEnd since={props.person.since}>
					<ShieldIcon className="text-primary size-4 shrink-0" />
				</PersonEnd>
			</PersonRow>
		)
	}
	return (
		<PersonRow
			person={props.person}
			selected={props.selected}
			onSelect={props.onSelect}
			removed={props.removed}
			failure={props.failure}
		>
			{Boolean.match(props.removed, {
				onFalse: () => (
					<PersonEnd since={props.person.since}>
						{props.removable && (
							<Button
								variant="ghost"
								size="icon-xs"
								className="max-sm:size-11"
								aria-label={`Remove ${name}`}
								title="Remove"
								onClick={props.onRemove}
							>
								<TrashIcon className="size-4" />
							</Button>
						)}
					</PersonEnd>
				),
				onTrue: () => (
					<ItemActions>
						<UndoButton onClick={props.undo} />
					</ItemActions>
				)
			})}
		</PersonRow>
	)
}

// One card: whoever is asking for access first, then everyone with it.
function Directory() {
	const signed = useAtomSuspense(accountAtom).value
	const selected = useAtomValue(selectedRowAtom)
	const setSelected = useAtomSet(selectedRowAtom)
	const send = useAtomSet(removePersonAtom.send)
	const waiting = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(removePersonAtom, 'Waiting')), Option.none)
	const failed = AsyncResult.getOrElse(useMachineResult(AtomMachine.select(removePersonAtom, 'Failed')), Option.none)
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
												failure={Option.map(
													Option.filter(failed, state => state.id === person.id),
													state => state.message
												)}
												removed={Option.exists(waiting, state => state.id === person.id)}
												removable={!Option.exists(signed, account => account.id === person.id)}
												selected={Option.contains(selected, `person-${person.id}`)}
												onSelect={() => setSelected(Option.some(`person-${person.id}`))}
												undo={() => send({_tag: 'Undone'})}
												onRemove={() => {
													send({_tag: 'Dismissed'})
													send({_tag: 'Removed', id: person.id})
												}}
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
