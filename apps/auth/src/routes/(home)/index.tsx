import {useAtom, useAtomSubscribe, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option, Order, Record, String, pipe} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, X} from 'lucide-react'
import {Suspense, useState} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {Button} from '@deslop/components-web/ui/button'
import {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot} from '@deslop/components-web/ui/input-otp'
import {cn} from '@deslop/components-web/utils'

import {Review} from '#lib/components.tsx'
import {
	accountAtom,
	ageLabel,
	appNames,
	appsAtom,
	clientLabel,
	consentAtom,
	disconnectAtom,
	linkedCode,
	lookupAtom,
	minuteAtom,
	minutesSince,
	newest
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

function machines(count: number) {
	if (count === 1) return '1 machine'
	return `${count} machines`
}

// A first tap arms the cell, a second signs that client out of that app; leaving the cell disarms it.
function Cell(props: {app: string; client: string; now: number; signIns: SignedInApp[]}) {
	const [disconnection, disconnect] = useAtom(disconnectAtom)
	const [armed, setArmed] = useState(false)
	if (Array.isArrayEmpty(props.signIns)) {
		return (
			<td
				className="text-muted-foreground/40 text-center"
				aria-label={`${props.client} is not signed in to ${props.app}`}
			>
				·
			</td>
		)
	}
	const minutes = minutesSince(newest(props.signIns), props.now)
	return (
		<td className="p-0.5">
			<Button
				size="lg"
				variant={Boolean.match(armed, {onFalse: () => 'secondary' as const, onTrue: () => 'destructive' as const})}
				className="w-full flex-col gap-1 text-xs tabular-nums"
				aria-label={Boolean.match(armed, {
					onFalse: () =>
						`${props.client} in ${props.app} on ${machines(props.signIns.length)}, active ${ageLabel(minutes)} ago; tap twice to sign out`,
					onTrue: () => `Sign ${props.client} out of ${props.app}`
				})}
				disabled={AsyncResult.isWaiting(disconnection)}
				onBlur={() => setArmed(false)}
				onClick={() => {
					if (armed) disconnect(Array.map(props.signIns, signIn => signIn.family))
					setArmed(!armed)
				}}
			>
				{Boolean.match(armed, {
					// One square per machine, lit while it was active in the last hour.
					onFalse: () => (
						<>
							{ageLabel(minutes)}
							<span className="flex gap-0.5" aria-hidden="true">
								{Array.map(props.signIns, signIn => (
									<span
										key={signIn.family}
										className={cn(
											'size-1',
											minutesSince(signIn.lastActive, props.now) < 60 && 'bg-primary',
											minutesSince(signIn.lastActive, props.now) >= 60 && 'bg-muted-foreground/50'
										)}
									/>
								))}
							</span>
						</>
					),
					onTrue: () => <X />
				})}
			</Button>
		</td>
	)
}

// Clients down, apps across, last active first; each cell holds one client's sign-ins to one app, from any machine.
function Apps() {
	const apps = useAtomSuspense(appsAtom).value
	const now = useAtomSuspense(minuteAtom).value
	const [disconnection] = useAtom(disconnectAtom)
	const columns = Array.sort(Array.dedupe(Array.flatMap(apps, app => appNames(app.resources))), String.Order)
	return (
		<section className="flex flex-col gap-2" aria-label="Signed in">
			<h2 className="text-muted-foreground text-xs tracking-wider uppercase">Signed in</h2>
			{Array.match(
				pipe(
					Array.groupBy(apps, clientLabel),
					Record.toEntries,
					Array.sort(Order.flip(Order.mapInput(Order.Number, (entry: [string, SignedInApp[]]) => newest(entry[1]))))
				),
				{
					onEmpty: () => <p className="text-muted-foreground text-sm">No apps signed in</p>,
					onNonEmpty: rows => (
						<table className="w-full table-fixed border-collapse text-sm">
							<thead>
								<tr>
									<th className="w-28">
										<span className="sr-only">Client</span>
									</th>
									{Array.map(columns, column => (
										<th key={column} scope="col" className="text-muted-foreground pb-1 text-xs font-normal">
											{column}
										</th>
									))}
								</tr>
							</thead>
							<tbody>
								{Array.map(rows, row => (
									<tr key={row[0]}>
										<th scope="row" className="truncate pr-2 text-left font-normal">
											{row[0]}
										</th>
										{Array.map(columns, column => (
											<Cell
												key={column}
												app={column}
												client={row[0]}
												now={now}
												signIns={Array.filter(row[1], app => Array.contains(appNames(app.resources), column))}
											/>
										))}
									</tr>
								))}
							</tbody>
						</table>
					)
				}
			)}
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
