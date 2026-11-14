import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Function, Option} from 'effect'

import {ShieldIcon, UsersIcon} from '@phosphor-icons/react'
import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'
import type {ReactNode} from 'react'

import {ResultError} from '@deslop/components-web/blocks/result-error'
import {LoadingRows, RowLead} from '@deslop/components-web/blocks/rows'
import {Loaded} from '@deslop/components-web/blocks/states'
import {AccountAvatar} from '@deslop/components-web/shell/app-bar'
import {Button} from '@deslop/components-web/ui/button'
import {Empty, EmptyHeader, EmptyMedia, EmptyTitle} from '@deslop/components-web/ui/empty'
import {Table, TableBody, TableCell, TableRow} from '@deslop/components-web/ui/table'
import {monthOf} from '@deslop/runtime/shared/format'

import {accountAtom, admitAtom, peopleAtom} from '#lib/auth.ts'
import type {Person} from '#services/people/schema.ts'

// One person: avatar, name, the admin shield and the handle muted beside it, then the row's last cell.
function PersonRow(props: {children: ReactNode; error?: ReactNode; person: Person; selected?: boolean}) {
	return (
		<TableRow
			data-state={Boolean.match(props.selected === true, {
				onFalse: Function.constUndefined,
				onTrue: Function.constant('selected')
			})}
		>
			<RowLead
				mark={<AccountAvatar account={props.person} size="sm" />}
				after={
					<>
						{props.person.role === 'Admin' && <ShieldIcon role="img" aria-label="Admin" className="text-primary" />}
						{props.error}
					</>
				}
				detail={Option.match(props.person.fullName, {
					onNone: Function.constUndefined,
					onSome: () => `@${props.person.name}`
				})}
			>
				{Option.getOrElse(props.person.fullName, () => props.person.name)}
			</RowLead>
			<TableCell className="text-right">{props.children}</TableCell>
		</TableRow>
	)
}

// A request for access is answered like a sign-in's code: Deny or Approve, each named for the person.
function AskingRow(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom(props.person.id))
	return (
		<PersonRow person={props.person} selected error={<ResultError result={admit} />}>
			<span className="flex gap-2">
				<Button
					size="xs"
					variant="outline"
					disabled={AsyncResult.isWaiting(admit)}
					aria-label={`Deny @${props.person.name}`}
					onClick={() => answer(false)}
				>
					Deny
				</Button>
				<Button
					size="xs"
					disabled={AsyncResult.isWaiting(admit)}
					aria-label={`Approve @${props.person.name}`}
					onClick={() => answer(true)}
				>
					Approve
				</Button>
			</span>
		</PersonRow>
	)
}

// A member's row ends with the month they joined.
function MemberRow(props: {person: Person}) {
	return (
		<PersonRow person={props.person}>
			<span className="text-muted-foreground tabular-nums">
				{Option.match(props.person.since, {onNone: Function.constNull, onSome: monthOf})}
			</span>
		</PersonRow>
	)
}

// One table: whoever is asking for access first, then everyone with it.
function Directory() {
	return (
		<Loaded atom={peopleAtom}>
			{rows => (
				<>
					<h1 className="sr-only">People</h1>
					{Array.match(rows, {
						onEmpty: () => (
							<Empty role="status">
								<EmptyHeader>
									<EmptyMedia variant="icon">
										<UsersIcon />
									</EmptyMedia>
									<EmptyTitle>No one yet</EmptyTitle>
								</EmptyHeader>
							</Empty>
						),
						onNonEmpty: entries => (
							<Table aria-label="People">
								<TableBody>
									{Array.map(entries, person =>
										Boolean.match(person.role === 'Waiting', {
											onFalse: () => <MemberRow key={person.id} person={person} />,
											onTrue: () => <AskingRow key={person.id} person={person} />
										})
									)}
								</TableBody>
							</Table>
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
		<Suspense fallback={<LoadingRows label="People" rows={3} />}>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/people')({component: PeopleRoute})
