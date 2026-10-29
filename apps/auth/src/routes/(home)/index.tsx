import {useAtomSubscribe, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, X} from 'lucide-react'
import {Suspense, useState} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot} from '@deslop/components-web/ui/input-otp'

import {SignedInGrid} from '#lib/components.tsx'
import {clientLabel, consentAtom, linkedCode, lookupAtom} from '#lib/utils.ts'
import {typedCode} from '#services/authorizations/lib/utils.ts'
import type {PendingAuthorization} from '#services/authorizations/schema.ts'

const CODE_LENGTH = 8

type Answer = {accept: boolean; request: PendingAuthorization}

// The last answer stays as one line under an empty code, ready for the next sign-in.
function Enter(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	state: 'Checking' | 'Found' | 'Missing' | 'Typing'
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
									{clientLabel(answer.request)} denied
								</>
							),
							onTrue: () => (
								<>
									<Check className="text-primary size-3.5" />
									{clientLabel(answer.request)} approved
								</>
							)
						})}
					</p>
				)
			})}
		</section>
	)
}

// The code stays in its field while the grid shows what it asks for.
function Page(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	pending: Option.Option<PendingAuthorization>
	state: 'Checking' | 'Found' | 'Missing' | 'Typing'
	typed: string
}) {
	return (
		<>
			<Enter answered={props.answered} onType={props.onType} state={props.state} typed={props.typed} />
			<Suspense fallback={<Loading />}>
				<SignedInGrid pending={props.pending} />
			</Suspense>
		</>
	)
}

// A full code reads its sign-in, live, so a request answered elsewhere or expired leaves the grid.
function Found(props: {code: string; onType: (code: string) => void}) {
	const waiting = useAtomSuspense(lookupAtom(props.code)).value
	return (
		<Page
			answered={Option.none()}
			onType={props.onType}
			pending={waiting}
			state={Option.match(waiting, {onNone: () => 'Missing' as const, onSome: () => 'Found' as const})}
			typed={props.code}
		/>
	)
}

// The code the waiting page shows, typed or opened from its link, proves the request is yours: RFC 8628's device flow.
function SignIns() {
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
	if (typed.length < CODE_LENGTH) {
		return <Page answered={answered} onType={type} pending={Option.none()} state="Typing" typed={typed} />
	}
	return (
		<Suspense
			fallback={<Page answered={Option.none()} onType={type} pending={Option.none()} state="Checking" typed={typed} />}
		>
			<Found key={typed} code={typed} onType={type} />
		</Suspense>
	)
}

export const Route = createFileRoute('/(home)/')({component: SignIns})
