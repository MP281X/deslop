import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Array, Boolean, Option, Predicate} from 'effect'

import {CheckIcon, XIcon} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {MachineState} from '@typeonce/effect-machine-react'
import {Suspense} from 'react'

import {ItemListSkeleton} from '@deslop/components-web/item-list'
import {Field, FieldError} from '@deslop/components-web/ui/field'
import {InputOTP, InputOTPGroup, InputOTPSeparator, InputOTPSlot} from '@deslop/components-web/ui/input-otp'
import {Spinner} from '@deslop/components-web/ui/spinner'
import {cn} from '@deslop/components-web/utils'

import {SignInList} from '#lib/components.tsx'
import {CLIENT_ROWS, codeAtom, consentAtom, linkedCodeAtom, signInLabel} from '#lib/utils.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'

type Answer = {accept: boolean; request: PendingAuthorization}

const route = getRouteApi('/(home)/')

// The last answer stays as one line under an empty code, ready for the next sign-in.
function Enter(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	state: 'Checking' | 'Found' | 'Missing' | 'Typing' | {failed: string}
	typed: string
}) {
	const linked = route.useSearch({select: search => search.code !== undefined})
	const invalid = props.state === 'Missing' || Predicate.isObject(props.state)
	return (
		<section className="flex w-full flex-col gap-4">
			<div className="border-rule-strong flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2 border-b-2 pb-2">
				<div className="flex items-baseline gap-3">
					<span className="text-signal font-mono text-xs tabular-nums">01</span>
					<h2 className="tracking-block text-sm font-extrabold uppercase">Sign in</h2>
				</div>
				<span className="text-muted-foreground text-2xs tracking-label font-mono uppercase">
					Approve a waiting code
				</span>
			</div>
			<div className="block-shadow border-foreground/70 bg-card flex flex-col gap-4 border-2 p-5 sm:p-6">
				<Field data-invalid={invalid}>
					<InputOTP
						id="code"
						aria-label="Code of a sign-in to approve"
						maxLength={CODE_LENGTH}
						value={props.typed}
						onChange={value => {
							props.onType(typedCode(value))
						}}
						pasteTransformer={typedCode}
						pattern="^[A-Za-z]+$"
						inputMode="text"
						autoFocus={linked}
						autoComplete="off"
						autoCapitalize="characters"
						disabled={props.state === 'Checking'}
						aria-invalid={invalid}
						aria-describedby="code-error"
						containerClassName={cn('gap-2', props.state === 'Missing' && 'animate-refuse motion-reduce:animate-none')}
					>
						<InputOTPGroup className="flex-1">
							{Array.map(Array.range(0, 3), index => (
								<InputOTPSlot key={index} index={index} aria-invalid={invalid} className="flex-1" />
							))}
						</InputOTPGroup>
						<InputOTPSeparator />
						<InputOTPGroup className="flex-1">
							{Array.map(Array.range(4, 7), index => (
								<InputOTPSlot key={index} index={index} aria-invalid={invalid} className="flex-1" />
							))}
						</InputOTPGroup>
					</InputOTP>
					{props.state === 'Checking' && (
						<p role="status" className="text-muted-foreground text-meta flex items-center gap-1.5 font-mono">
							<Spinner />
							Checking…
						</p>
					)}
					{props.state === 'Missing' && <FieldError id="code-error">No waiting sign-in has this code.</FieldError>}
					{Predicate.isObject(props.state) && <FieldError id="code-error">{props.state.failed}</FieldError>}
				</Field>
				{Option.match(props.answered, {
					onNone: () => null,
					onSome: answer => (
						<p
							className="text-muted-foreground animate-settle-in text-meta flex items-center gap-1.5 font-mono motion-reduce:animate-none"
							role="status"
						>
							{Boolean.match(answer.accept, {
								onFalse: () => (
									<>
										<XIcon className="size-3.5" />
										{signInLabel(answer.request.clientName, answer.request.device)} denied
									</>
								),
								onTrue: () => (
									<>
										<CheckIcon className="text-primary size-3.5" />
										{signInLabel(answer.request.clientName, answer.request.device)} approved
									</>
								)
							})}
						</p>
					)
				})}
			</div>
		</section>
	)
}

// The code and signed-in clients share one centred column.
function Page(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	pending: Option.Option<PendingAuthorization>
	state: 'Checking' | 'Found' | 'Missing' | 'Typing' | {failed: string}
	typed: string
}) {
	return (
		<div className="m-auto flex w-full max-w-3xl flex-col gap-8 py-8">
			<h1 className="sr-only">Auth</h1>
			<Enter answered={props.answered} onType={props.onType} state={props.state} typed={props.typed} />
			<Suspense fallback={<ItemListSkeleton label="Signed in" media rows={CLIENT_ROWS} />}>
				<SignInList pending={props.pending} />
			</Suspense>
		</div>
	)
}

function SignIns() {
	useAtomMount(linkedCodeAtom(route.useSearch({select: search => search.code ?? ''})))
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
						<MachineState machine={codeAtom} path="Code.Failed">
							{failed => (
								<Page
									answered={Option.none()}
									onType={type}
									pending={Option.none()}
									state={{failed: failed.value.message}}
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
