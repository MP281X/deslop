import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {Navigate, createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'

import {Avatar} from '#lib/components.tsx'
import {accountAtom, admitAtom, dayLabel, peopleAtom, removeAtom} from '#lib/utils.ts'
import type {Person} from '#services/authorizations/schema.ts'

function Identity(props: {detail: string; person: Person}) {
	return (
		<>
			<Avatar id={props.person.id} name={props.person.name} />
			<div className="flex min-w-0 grow flex-col">
				<span className="truncate">{props.person.fullName ?? props.person.name}</span>
				<span className="text-muted-foreground truncate">
					@{props.person.name} · {props.detail}
				</span>
			</div>
		</>
	)
}

function AskingRow(props: {person: Person}) {
	const [admit, answer] = useAtom(admitAtom)
	return (
		<li className="flex items-center gap-3 text-xs">
			<Identity person={props.person} detail={dayLabel(props.person.since)} />
			<Button
				size="sm"
				disabled={AsyncResult.isWaiting(admit)}
				onClick={() => answer({allow: true, id: props.person.id})}
			>
				Allow
			</Button>
			<Button
				size="sm"
				variant="secondary"
				disabled={AsyncResult.isWaiting(admit)}
				onClick={() => answer({allow: false, id: props.person.id})}
			>
				Decline
			</Button>
		</li>
	)
}

function MemberRow(props: {person: Person}) {
	const [removal, remove] = useAtom(removeAtom)
	return (
		<li className="flex items-center gap-3 text-xs">
			<Identity
				person={props.person}
				detail={Boolean.match(props.person.role === 'Admin', {
					onFalse: () => `since ${dayLabel(props.person.since)}`,
					onTrue: () => 'admin'
				})}
			/>
			{props.person.role === 'Member' && (
				<Button
					size="sm"
					variant="secondary"
					disabled={AsyncResult.isWaiting(removal)}
					onClick={() => remove(props.person.id)}
				>
					Remove
				</Button>
			)}
		</li>
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
			<section className="flex flex-col gap-2" aria-label="Asking for access">
				<h2 className="text-muted-foreground text-xs tracking-wider uppercase">Asking · {asking.length}</h2>
				{Array.match(asking, {
					onEmpty: () => <p className="text-muted-foreground text-xs">No one is asking</p>,
					onNonEmpty: waiting => (
						<ul className="flex flex-col gap-3">
							{Array.map(waiting, person => (
								<AskingRow key={person.id} person={person} />
							))}
						</ul>
					)
				})}
			</section>
			<section className="flex flex-col gap-2" aria-label="With access">
				<h2 className="text-muted-foreground text-xs tracking-wider uppercase">With access · {members.length}</h2>
				<ul className="flex flex-col gap-3">
					{Array.map(members, person => (
						<MemberRow key={person.id} person={person} />
					))}
				</ul>
			</section>
			{Option.match(error, {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-sm" role="alert">
						{failure.message}
					</p>
				)
			})}
		</>
	)
}

// Admins manage people here; anyone else who opens it goes back to their sign-ins.
function People() {
	if (!Option.exists(useAtomSuspense(accountAtom).value, signed => signed.role === 'Admin')) return <Navigate to="/" />
	return (
		<Suspense fallback={<Loading />}>
			<Directory />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/people')({component: People})
