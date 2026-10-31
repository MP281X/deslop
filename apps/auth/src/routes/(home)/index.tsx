import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {MachineState} from '@typeonce/effect-machine-react'
import {Check, X} from 'lucide-react'
import {Suspense} from 'react'

import {Loading} from '@deslop/components-web/fallbacks'
import {FieldError} from '@deslop/components-web/ui/field'
import {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot} from '@deslop/components-web/ui/input-otp'
import {cn} from '@deslop/components-web/utils'

import {SignedInGrid} from '#lib/components.tsx'
import {codeAtom, consentAtom, linkedCodeAtom, signInLabel} from '#lib/utils.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'

type Answer = {accept: boolean; request: PendingAuthorization}

// The last answer stays as one line under an empty code, ready for the next sign-in.
function Enter(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	state: 'Checking' | 'Found' | 'Missing' | 'Typing'
	typed: string
}) {
	return (
		<section className="flex flex-col gap-4">
			<div className="flex flex-col gap-1">
				<h1 className="text-xl font-semibold tracking-tight">Approve a sign-in</h1>
				<label htmlFor="code" className="text-muted-foreground text-sm">
					Type the code your device shows.
				</label>
			</div>
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
				containerClassName={cn('gap-2', props.state === 'Missing' && 'refuse')}
			>
				<InputOTPGroup className="flex-1">
					{Array.map(Array.range(0, 3), index => (
						<InputOTPSlot
							key={index}
							index={index}
							aria-invalid={props.state === 'Missing'}
							className="h-11 flex-1 font-mono text-lg"
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
							className="h-11 flex-1 font-mono text-lg"
						/>
					))}
				</InputOTPGroup>
			</InputOTP>
			{props.state === 'Missing' && <FieldError id="code-error">No waiting sign-in has this code.</FieldError>}
			{Option.match(props.answered, {
				onNone: () => null,
				onSome: answer => (
					<p className="text-muted-foreground settle-in flex items-center gap-1.5 text-xs" role="status">
						{Boolean.match(answer.accept, {
							onFalse: () => (
								<>
									<X className="size-3.5" />
									{signInLabel(answer.request.clientName, answer.request.device)} denied
								</>
							),
							onTrue: () => (
								<>
									<Check className="text-primary size-3.5" />
									{signInLabel(answer.request.clientName, answer.request.device)} approved
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

function SignIns() {
	useAtomMount(linkedCodeAtom)
	// The answer outlives the card: the lookup can drop its request before the consent response arrives.
	useAtomMount(consentAtom)
	const send = useAtomSet(codeAtom.send)
	function type(typed: string) {
		send({_tag: 'Typed', typed})
	}
	return (
		<>
			<MachineState machine={codeAtom} path="Typing">
				{typing => (
					<Page
						answered={Option.fromUndefinedOr(typing.value.answered)}
						onType={type}
						pending={Option.none()}
						state="Typing"
						typed={typing.value.typed}
					/>
				)}
			</MachineState>
			<MachineState machine={codeAtom} path="Code">
				{code => (
					<>
						<MachineState machine={codeAtom} path="Code.Looking">
							{() => (
								<Page
									answered={Option.none()}
									onType={type}
									pending={Option.none()}
									state="Checking"
									typed={code.value.code}
								/>
							)}
						</MachineState>
						<MachineState machine={codeAtom} path="Code.Found">
							{found => (
								<Page
									answered={Option.none()}
									onType={type}
									pending={Option.some(found.value.request)}
									state="Found"
									typed={code.value.code}
								/>
							)}
						</MachineState>
						<MachineState machine={codeAtom} path="Code.Missing">
							{() => (
								<Page
									answered={Option.none()}
									onType={type}
									pending={Option.none()}
									state="Missing"
									typed={code.value.code}
								/>
							)}
						</MachineState>
					</>
				)}
			</MachineState>
		</>
	)
}

export const Route = createFileRoute('/(home)/')({component: SignIns})
