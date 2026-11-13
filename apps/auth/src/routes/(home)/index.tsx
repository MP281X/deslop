import {useAtomMount, useAtomSet, useAtomValue} from '@effect/atom-react'

import {Boolean, Function, Option} from 'effect'

import {CheckIcon, KeyIcon, XIcon} from '@phosphor-icons/react'
import {createFileRoute, getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Suspense} from 'react'

import {Field, FieldError} from '@deslop/components-web/ui/field'
import {InputGroup, InputGroupAddon, InputGroupInput} from '@deslop/components-web/ui/input-group'

import {codeAtom, codeViewAtom, consentAtom, linkedCodeAtom, signInLabel} from '#lib/auth.ts'
import type {CodeState, CodeView} from '#lib/auth.ts'
import {SignInList, SignInRowsSkeleton} from '#lib/components.tsx'
import {CODE_LENGTH, typedCode} from '#services/sign-ins/lib/utils.ts'
import type {PendingAuthorization} from '#services/sign-ins/schema.ts'

type Answer = {accept: boolean; request: PendingAuthorization}

const route = getRouteApi('/(home)/')

// Leaving the page hides the code field's keyboard; iOS would otherwise restore it, and its strip, on return.
function blurWhenHidden(input: HTMLInputElement) {
	function blur() {
		input.blur()
	}
	function onVisibilityChange() {
		if (document.visibilityState === 'hidden') blur()
	}
	document.addEventListener('visibilitychange', onVisibilityChange)
	addEventListener('pagehide', blur)
	return () => {
		document.removeEventListener('visibilitychange', onVisibilityChange)
		removeEventListener('pagehide', blur)
	}
}

function Enter(props: {
	answered: Option.Option<Answer>
	onType: (code: string) => void
	state: CodeState
	typed: string
}) {
	const linked = route.useSearch({select: search => Option.isSome(search.code)})
	const invalid = props.state._tag === 'Missing' || props.state._tag === 'Failed'
	return (
		<section className="flex w-full flex-col gap-2">
			<Field data-invalid={invalid}>
				<InputGroup className="h-9 max-sm:h-11">
					<InputGroupAddon>
						<KeyIcon />
					</InputGroupAddon>
					<InputGroupInput
						id="code"
						ref={blurWhenHidden}
						className="max-sm:h-11"
						aria-label="Code of a sign-in to approve"
						placeholder="Code"
						maxLength={CODE_LENGTH}
						value={props.typed}
						onChange={event => props.onType(typedCode(event.target.value))}
						autoFocus={linked}
						autoComplete="off"
						autoCapitalize="characters"
						spellCheck={false}
						disabled={props.state._tag === 'Checking'}
						aria-invalid={invalid}
						aria-describedby="code-error"
					/>
				</InputGroup>
				{props.state._tag === 'Missing' && <FieldError id="code-error">No waiting sign-in has this code.</FieldError>}
				{props.state._tag === 'Failed' && <FieldError id="code-error">{props.state.message}</FieldError>}
			</Field>
			{Option.match(props.answered, {
				onNone: Function.constNull,
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
									<CheckIcon className="size-3.5" />
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

function Content(props: CodeView & {onType: (code: string) => void}) {
	return (
		<>
			<h1 className="sr-only">Auth</h1>
			<Enter answered={props.answered} onType={props.onType} state={props.state} typed={props.typed} />
			<Suspense
				fallback={<SignInRowsSkeleton pending={props.state._tag === 'Checking' || Option.isSome(props.pending)} />}
			>
				<SignInList checking={props.state._tag === 'Checking'} pending={props.pending} />
			</Suspense>
		</>
	)
}

function SignInsRoute() {
	useAtomMount(linkedCodeAtom(route.useSearch({select: search => Option.getOrElse(search.code, () => '')})))
	// The answer outlives the card: the lookup can drop its request before the consent response arrives.
	useAtomMount(consentAtom)
	const send = useAtomSet(codeAtom.send)
	function type(typed: string) {
		send({_tag: 'Typed', typed})
	}
	return Option.match(AsyncResult.value(useAtomValue(codeViewAtom)), {
		onNone: Function.constNull,
		onSome: view => <Content {...view} onType={type} />
	})
}

export const Route = createFileRoute('/(home)/')({component: SignInsRoute})
