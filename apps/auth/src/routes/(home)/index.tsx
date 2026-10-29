import {useAtom, useAtomSubscribe, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, X} from 'lucide-react'
import {Suspense, useState} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'
import {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot} from '@deslop/components-web/ui/input-otp'

import {Review} from '#lib/components.tsx'
import {
	accountAtom,
	agoLabel,
	appNames,
	appsAtom,
	consentAtom,
	disconnectAtom,
	linkedCode,
	lookupAtom,
	minuteAtom
} from '#lib/utils.ts'
import {typedCode} from '#services/authorizations/lib/utils.ts'
import type {PendingAuthorization, SignedInApp} from '#services/authorizations/schema.ts'

const CODE_LENGTH = 8

type Answer = {accept: boolean; request: PendingAuthorization}

// The last answer stays as one line under an empty code, ready for the next sign-in.
function Enter(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	state: 'Checking' | 'Missing' | 'Typing'
	typed: string
}) {
	return (
		<section className="flex flex-col gap-3">
			<label htmlFor="code" className="text-muted-foreground text-xs tracking-wider uppercase">
				Enter a code
			</label>
			<InputOTP
				id="code"
				maxLength={CODE_LENGTH}
				value={props.typed}
				onChange={value => {
					props.onType(typedCode(value))
				}}
				pasteTransformer={typedCode}
				pattern="^[A-Za-z]+$"
				inputMode="text"
				autoFocus
				autoComplete="off"
				autoCapitalize="characters"
				disabled={props.state === 'Checking'}
				aria-invalid={props.state === 'Missing'}
				aria-describedby="code-error"
				containerClassName="gap-2"
			>
				<InputOTPGroup className="flex-1">
					{Array.map(Array.range(0, 3), index => (
						<InputOTPSlot
							key={index}
							index={index}
							aria-invalid={props.state === 'Missing'}
							className="h-12 flex-1 text-lg font-semibold"
						/>
					))}
				</InputOTPGroup>
				<InputOTPSeparator />
				<InputOTPGroup className="flex-1">
					{Array.map(Array.range(4, 7), index => (
						<InputOTPSlot
							key={index}
							index={index}
							aria-invalid={props.state === 'Missing'}
							className="h-12 flex-1 text-lg font-semibold"
						/>
					))}
				</InputOTPGroup>
			</InputOTP>
			{props.state === 'Missing' && (
				<p id="code-error" className="text-destructive text-xs" role="alert">
					No waiting sign-in has this code.
				</p>
			)}
			{Option.match(props.answered, {
				onNone: () => null,
				onSome: answer => (
					<p className="text-muted-foreground flex items-center gap-1.5 text-xs" role="status">
						{Boolean.match(answer.accept, {
							onFalse: () => (
								<>
									<X className="size-3.5" />
									{answer.request.clientName} denied
								</>
							),
							onTrue: () => (
								<>
									<Check className="text-primary size-3.5" />
									{answer.request.clientName} approved
								</>
							)
						})}
					</p>
				)
			})}
		</section>
	)
}

// A full code reads its sign-in, live, so a request answered elsewhere or expired goes back to the code.
function Found(props: {code: string; onType: (code: string) => void}) {
	const account = useAtomSuspense(accountAtom).value
	const waiting = useAtomSuspense(lookupAtom(props.code)).value
	return Option.match(
		Option.flatMap(account, signed => Option.map(waiting, request => ({request, signed}))),
		{
			onNone: () => <Enter answered={Option.none()} onType={props.onType} state="Missing" typed={props.code} />,
			onSome: found => <Review account={found.signed} request={found.request} />
		}
	)
}

// The code the waiting page shows, typed or opened from its link, proves the request is yours: RFC 8628's device flow.
function Approve() {
	const [typed, setTyped] = useState<string>(linkedCode)
	const [answered, setAnswered] = useState(() => Option.none<Answer>())
	// While the next answer is sent, the atom still holds the previous success, marked waiting.
	useAtomSubscribe(consentAtom, result => {
		if (!AsyncResult.isSuccess(result) || AsyncResult.isWaiting(result)) return
		setAnswered(Option.some(result.value))
		setTyped('')
	})
	function type(code: string) {
		setAnswered(Option.none())
		setTyped(code)
	}
	if (typed.length < CODE_LENGTH) return <Enter answered={answered} onType={type} state="Typing" typed={typed} />
	return (
		<Suspense fallback={<Enter answered={Option.none()} onType={type} state="Checking" typed={typed} />}>
			<Found key={typed} code={typed} onType={type} />
		</Suspense>
	)
}

function AppRow(props: {app: SignedInApp; now: number}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	return (
		<li className="bg-card flex items-center gap-3 p-4">
			<div className="flex min-w-0 grow flex-col">
				<span className="truncate text-sm">{props.app.clientName}</span>
				<span className="text-muted-foreground truncate text-xs">
					{Array.join([...appNames(props.app.resources), agoLabel(props.app.lastActive, props.now)], ' · ')}
				</span>
			</div>
			<Button
				size="sm"
				variant="secondary"
				disabled={AsyncResult.isWaiting(disconnection)}
				onClick={() => disconnect(props.app.family)}
			>
				Disconnect
			</Button>
		</li>
	)
}

// Each app or agent this account signed in to, last active first; disconnecting one makes it sign in again.
function Apps() {
	const apps = useAtomSuspense(appsAtom).value
	const now = useAtomSuspense(minuteAtom).value
	const [disconnection] = useAtom(disconnectAtom)
	return (
		<section className="flex flex-col gap-3" aria-label="Signed in">
			<h2 className="text-muted-foreground text-xs tracking-wider uppercase">Signed in · {apps.length}</h2>
			{Array.match(apps, {
				onEmpty: () => <p className="text-muted-foreground bg-card p-4 text-sm">No apps signed in</p>,
				onNonEmpty: rows => (
					<ul className="flex flex-col gap-2">
						{Array.map(rows, app => (
							<AppRow key={app.family} app={app} now={now} />
						))}
					</ul>
				)
			})}
			{Option.match(AsyncResult.error(disconnection), {
				onNone: () => null,
				onSome: failure => (
					<p className="text-destructive text-sm" role="alert">
						{failure.message}
					</p>
				)
			})}
		</section>
	)
}

function SignIns() {
	return (
		<>
			<Approve />
			<Suspense fallback={<Loading />}>
				<Apps />
			</Suspense>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: SignIns})
