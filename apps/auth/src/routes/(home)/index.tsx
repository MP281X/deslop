import {useAtom, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, String} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'

import {applicationName, connectedAtom, consentAtom, pendingAtom, requestCode, timeLabel} from '#lib/utils.ts'
import type {PendingAuthorization} from '#services/authorizations/schema.ts'

export const Route = createFileRoute('/(home)/')({component: SignIns})

function SignIns() {
	return (
		<Suspense fallback={<Loading />}>
			<Inbox />
		</Suspense>
	)
}

function RequestCard(props: {request: PendingAuthorization}) {
	const connected = useAtomValue(connectedAtom)
	const [consent, respond] = useAtom(consentAtom)
	return (
		<li className="bg-card flex flex-col gap-3 p-4">
			<div className="flex items-start gap-3">
				<div className="flex min-w-0 grow flex-col">
					<span className="truncate text-sm">
						{Array.join(
							Array.dedupeWith([applicationName(props.request), props.request.clientName], (left, right) =>
								String.Equivalence(String.toLowerCase(left), String.toLowerCase(right))
							),
							' · '
						)}
					</span>
					<span className="text-muted-foreground truncate text-xs">
						<span className="text-foreground font-medium tabular-nums">{requestCode(props.request.id)}</span> ·{' '}
						{props.request.redirectUri}
					</span>
				</div>
				<span className="text-muted-foreground shrink-0 text-xs tabular-nums">
					until {timeLabel(props.request.expiresAt)}
				</span>
			</div>
			<div className="grid grid-cols-2 gap-2">
				<Button
					size="lg"
					disabled={!connected || AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: true, request: props.request})}
				>
					Approve
				</Button>
				<Button
					size="lg"
					variant="secondary"
					disabled={!connected || AsyncResult.isWaiting(consent)}
					onClick={() => respond({accept: false, request: props.request})}
				>
					Deny
				</Button>
			</div>
		</li>
	)
}

function Inbox() {
	const requests = useAtomSuspense(pendingAtom).value
	const connected = useAtomValue(connectedAtom)
	const consent = useAtomValue(consentAtom)
	return (
		<section className="flex flex-col gap-3" aria-label="Sign-ins waiting">
			<h2 className="text-muted-foreground text-xs tracking-wider uppercase">Waiting · {requests.length}</h2>
			{Array.match(requests, {
				onEmpty: () => <p className="text-muted-foreground bg-card p-4 text-sm">No sign-ins waiting</p>,
				onNonEmpty: pending => (
					<ul className="flex flex-col gap-2">
						{Array.map(pending, request => (
							<RequestCard key={request.id} request={request} />
						))}
					</ul>
				)
			})}
			<p className="text-muted-foreground text-xs" role="status">
				{Option.match(AsyncResult.error(consent), {
					onNone: () =>
						Boolean.match(connected, {
							onFalse: () => 'Reconnecting · approvals paused until live updates return',
							onTrue: () => 'Approve only sign-ins you started; agents with the auth MCP approve their own.'
						}),
					onSome: failure => failure.message
				})}
			</p>
		</section>
	)
}
