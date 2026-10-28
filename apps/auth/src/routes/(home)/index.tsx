import {useAtomSubscribe, useAtomSuspense, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense, useState} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot} from '@deslop/components-web/ui/input-otp'

import {RequestCard} from '#lib/components.tsx'
import {accountAtom, applicationName, consentAtom, linkedCode, lookupAtom, typedCode} from '#lib/utils.ts'

const CODE_LENGTH = 8

function Found(props: {code: string}) {
	const account = useAtomSuspense(accountAtom).value
	const waiting = useAtomSuspense(lookupAtom(props.code)).value
	return Option.match(
		Option.flatMap(account, signed => Option.map(waiting, request => ({request, signed}))),
		{
			onNone: () => (
				<p className="text-destructive text-sm" role="alert">
					No waiting sign-in has this code. Check it, or start the sign-in again.
				</p>
			),
			onSome: found => <RequestCard account={found.signed} request={found.request} />
		}
	)
}

// The code the sign-in screen shows, typed or opened from its link, proves the request is yours: RFC 8628's device flow.
function Approve() {
	const consent = useAtomValue(consentAtom)
	const [typed, setTyped] = useState(linkedCode)
	// Only an answer that went through clears the code; a failed one keeps the card to try again.
	useAtomSubscribe(consentAtom, result => {
		if (AsyncResult.isSuccess(result)) setTyped('')
	})
	return (
		<section className="flex flex-col gap-3" aria-label="Approve a sign-in">
			<label htmlFor="code" className="text-muted-foreground text-xs tracking-wider uppercase">
				Code from the sign-in screen
			</label>
			<InputOTP
				id="code"
				maxLength={CODE_LENGTH}
				value={typed}
				onChange={value => {
					setTyped(typedCode(value))
				}}
				pasteTransformer={typedCode}
				pattern="^[A-Za-z]+$"
				inputMode="text"
				autoFocus
				autoComplete="off"
				autoCapitalize="characters"
				containerClassName="justify-center gap-2"
			>
				<InputOTPGroup>
					{Array.map(Array.range(0, 3), index => (
						<InputOTPSlot key={index} index={index} className="h-12 w-10 text-lg font-semibold" />
					))}
				</InputOTPGroup>
				<InputOTPSeparator />
				<InputOTPGroup>
					{Array.map(Array.range(4, 7), index => (
						<InputOTPSlot key={index} index={index} className="h-12 w-10 text-lg font-semibold" />
					))}
				</InputOTPGroup>
			</InputOTP>
			{typed.length === CODE_LENGTH && (
				<Suspense fallback={<Loading />}>
					<Found key={typed} code={typed} />
				</Suspense>
			)}
			<p className="text-muted-foreground text-xs" role="status">
				{Option.match(
					Option.filter(AsyncResult.value(consent), () => AsyncResult.isSuccess(consent)),
					{
						onNone: () => '',
						onSome: answered =>
							`${applicationName(answered.request)} ${Boolean.match(answered.accept, {
								onFalse: () => 'denied',
								onTrue: () => 'approved'
							})}`
					}
				)}
			</p>
		</section>
	)
}

export const Route = createFileRoute('/(home)/')({component: Approve})
