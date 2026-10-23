import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'
import {Input} from '@deslop/components-web/ui/input'

import {Avatar} from '#lib/components.tsx'
import {accountAtom, applicationName, consentAtom, pendingAtom, timeLabel, typedCode} from '#lib/utils.ts'
import type {Account, PendingAuthorization} from '#services/authorizations/schema.ts'

export const Route = createFileRoute('/(home)/')({component: SignIns})

function SignIns() {
	return (
		<Suspense fallback={<Loading />}>
			<Approve />
		</Suspense>
	)
}

function RequestCard(props: {account: Account; onAnswer: (accept: boolean) => void; request: PendingAuthorization}) {
	const [consent] = useAtom(consentAtom)
	return (
		<div className="bg-card flex flex-col gap-3 p-4">
			<div className="flex items-start gap-3">
				<div className="flex min-w-0 grow flex-col">
					<span className="truncate text-sm font-medium">
						{Array.join(
							Array.dedupeWith([applicationName(props.request), props.request.clientName], (left, right) =>
								String.Equivalence(String.toLowerCase(left), String.toLowerCase(right))
							),
							' · '
						)}
					</span>
					<span className="text-muted-foreground truncate text-xs">{props.request.redirectUri}</span>
				</div>
				<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
					until {timeLabel(props.request.expiresAt)}
				</span>
			</div>
			<div className="text-muted-foreground flex items-center gap-2 text-xs">
				<Avatar id={props.account.id} name={props.account.name} />
				<span className="truncate">
					Signs in as <span className="text-foreground">{props.account.fullName ?? props.account.name}</span>
				</span>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<Button size="lg" disabled={AsyncResult.isWaiting(consent)} onClick={() => props.onAnswer(true)}>
					Approve
				</Button>
				<Button
					size="lg"
					variant="secondary"
					disabled={AsyncResult.isWaiting(consent)}
					onClick={() => props.onAnswer(false)}
				>
					Deny
				</Button>
			</div>
		</div>
	)
}

// The code the sign-in screen shows, typed here, proves the request is yours: RFC 8628's device flow.
function Approve() {
	const requests = useAtomSuspense(pendingAtom).value
	const account = useAtomSuspense(accountAtom).value
	const [consent, respond] = useAtom(consentAtom)
	const [typed, setTyped] = useState('')
	const code = typedCode(typed)
	return (
		<section className="flex flex-col gap-3" aria-label="Approve a sign-in">
			<label htmlFor="code" className="text-muted-foreground text-xs tracking-wider uppercase">
				Code from the sign-in screen
			</label>
			<Input
				id="code"
				value={typed}
				onChange={event => setTyped(event.target.value)}
				placeholder="WDJB-MJHT"
				autoFocus
				autoComplete="off"
				autoCapitalize="characters"
				spellCheck={false}
				maxLength={9}
				className="h-12 text-center font-mono text-xl tracking-widest uppercase"
			/>
			{Option.match(
				Option.flatMap(account, signed =>
					Option.map(
						Array.findFirst(requests, request => request.id === code),
						request => ({request, signed})
					)
				),
				{
					// The answered sign-in leaves the waiting list, so its code reads as answered rather than unknown.
					onNone: () =>
						code.length === 8 &&
						!Option.exists(AsyncResult.value(consent), answered => answered.request.id === code) && (
							<p className="text-destructive text-sm" role="alert">
								No waiting sign-in has this code. Check it, or start the sign-in again.
							</p>
						),
					onSome: found => (
						<RequestCard
							account={found.signed}
							request={found.request}
							onAnswer={accept => respond({accept, request: found.request})}
						/>
					)
				}
			)}
			<p className="text-muted-foreground text-xs" role="status">
				{Option.match(AsyncResult.error(consent), {
					onNone: () =>
						Boolean.match(AsyncResult.isWaiting(consent), {
							onFalse: () =>
								Option.match(AsyncResult.value(consent), {
									onNone: () => `${requests.length} waiting`,
									onSome: answered =>
										`${applicationName(answered.request)} ${Boolean.match(answered.accept, {
											onFalse: () => 'denied',
											onTrue: () => 'approved'
										})}`
								}),
							onTrue: () => 'Answering…'
						}),
					onSome: failure => failure.message
				})}
			</p>
		</section>
	)
}
