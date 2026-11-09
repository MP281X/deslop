import {useAtomMount, useAtomSet} from '@effect/atom-react'

import {Boolean, Option, Predicate} from 'effect'

import {CheckIcon, KeyIcon, XIcon} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {MachineState} from '@typeonce/effect-machine-react'
import {Suspense} from 'react'

import {Field, FieldError} from '@deslop/components-web/ui/field'
import {InputGroup, InputGroupAddon, InputGroupInput} from '@deslop/components-web/ui/input-group'

import {SignInList, SignInRowsSkeleton} from '#lib/components.tsx'
import {CLIENT_ROWS, codeAtom, consentAtom, linkedCodeAtom, signInLabel} from '#lib/utils.ts'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'

type Answer = {accept: boolean; request: PendingAuthorization}

const route = getRouteApi('/(home)/')

function Enter(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	state: 'Checking' | 'Found' | 'Missing' | 'Typing' | {failed: string}
	typed: string
}) {
	const linked = route.useSearch({select: search => search.code !== undefined})
	const invalid = props.state === 'Missing' || Predicate.isObject(props.state)
	return (
		<section className="flex w-full flex-col gap-2">
			<Field data-invalid={invalid}>
				<InputGroup className="h-9">
					<InputGroupAddon>
						<KeyIcon />
					</InputGroupAddon>
					<InputGroupInput
						id="code"
						aria-label="Code of a sign-in to approve"
						placeholder="Code"
						maxLength={CODE_LENGTH}
						value={props.typed}
						onChange={event => props.onType(typedCode(event.target.value))}
						autoFocus={linked}
						autoComplete="off"
						autoCapitalize="characters"
						spellCheck={false}
						disabled={props.state === 'Checking'}
						aria-invalid={invalid}
						aria-describedby="code-error"
					/>
				</InputGroup>
				{props.state === 'Missing' && <FieldError id="code-error">No waiting sign-in has this code.</FieldError>}
				{Predicate.isObject(props.state) && <FieldError id="code-error">{props.state.failed}</FieldError>}
			</Field>
			{Option.match(props.answered, {
				onNone: () => null,
				onSome: answer => (
					<p className="text-muted-foreground flex items-center gap-1.5 text-xs" role="status">
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
		</section>
	)
}

function Content(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	pending: Option.Option<PendingAuthorization>
	state: 'Checking' | 'Found' | 'Missing' | 'Typing' | {failed: string}
	typed: string
}) {
	return (
		<>
			<h1 className="sr-only">Auth</h1>
			<Enter answered={props.answered} onType={props.onType} state={props.state} typed={props.typed} />
			<Suspense
				fallback={
					<SignInRowsSkeleton
						label="Signed in"
						pending={props.state === 'Checking' || Option.isSome(props.pending)}
						rows={CLIENT_ROWS}
					/>
				}
			>
				<SignInList checking={props.state === 'Checking'} pending={props.pending} />
			</Suspense>
		</>
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
					<Content
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
								<Content
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
								<Content
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
								<Content
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
								<Content
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
