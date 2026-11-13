import {useAtom} from '@effect/atom-react'

import {Array, Boolean, Match, Option, Redacted, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {ThemedMark} from '@deslop/components-web/marks'
import {ResultError} from '@deslop/components-web/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@deslop/components-web/ui/dialog'
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@deslop/components-web/ui/select'
import {AnthropicBlack} from '@deslop/components-web/ui/svgs/anthropicBlack'
import {AnthropicWhite} from '@deslop/components-web/ui/svgs/anthropicWhite'
import {Opencode} from '@deslop/components-web/ui/svgs/opencode'
import {OpencodeDark} from '@deslop/components-web/ui/svgs/opencodeDark'
import {OpenrouterDark} from '@deslop/components-web/ui/svgs/openrouterDark'
import {OpenrouterLight} from '@deslop/components-web/ui/svgs/openrouterLight'

import {setKeyAtom} from '#lib/gateway.ts'
import {AiProvider, PROVIDER_NAMES} from '#services/ai-proxy/schema.ts'

export const PROVIDERS = AiProvider.literals

export function ProviderMark(props: {provider: AiProvider}) {
	return pipe(
		Match.value(props.provider),
		Match.when('anthropic', () => <ThemedMark light={AnthropicBlack} dark={AnthropicWhite} className="size-4" />),
		Match.whenOr('opencode-go', 'opencode-zen', () => (
			<ThemedMark light={Opencode} dark={OpencodeDark} className="size-4" />
		)),
		Match.when('openrouter', () => <ThemedMark light={OpenrouterLight} dark={OpenrouterDark} className="size-4" />),
		Match.exhaustive
	)
}

// The key a paste offered: its prefix names the provider when it can, otherwise the flow's first provider.
export function providerOfKey(key: string) {
	if (String.startsWith('sk-ant-')(key)) return 'anthropic'
	if (String.startsWith('sk-or-')(key)) return 'openrouter'
	return PROVIDERS[0]
}

// One dialog adds or replaces a key: the provider, then the secret, which never comes back; it closes once saved.
export function AddKeyDialog(props: {
	onOpenChange: (open: boolean) => void
	onProvider: (provider: AiProvider) => void
	open: boolean
	provider: AiProvider
	secret: string
}) {
	const [result, save] = useAtom(setKeyAtom)
	// oxlint-disable-next-line react-doctor/no-derived-useState -- Each opening remounts the dialog with the pasted key as its start.
	const [secret, setSecret] = useState(props.secret)
	const waiting = AsyncResult.isWaiting(result)
	return (
		<Dialog open={props.open && !AsyncResult.isSuccess(result)} onOpenChange={props.onOpenChange}>
			{/* Cancel already closes it, so the corner X would be the same action twice. */}
			<DialogContent showCloseButton={false}>
				<form
					className="flex flex-col gap-4"
					onSubmit={event => {
						event.preventDefault()
						save({payload: {provider: props.provider, secret: Redacted.make(secret)}, reactivityKeys: ['aiKeys']})
					}}
				>
					<DialogHeader>
						<DialogTitle>Add a key</DialogTitle>
					</DialogHeader>
					<Field>
						<FieldLabel htmlFor="ai-provider">Provider</FieldLabel>
						<Select
							items={Array.map(PROVIDERS, value => ({label: PROVIDER_NAMES[value], value}))}
							value={props.provider}
							onValueChange={value => Option.map(Option.fromNullOr(value), props.onProvider)}
							disabled={waiting}
						>
							<SelectTrigger id="ai-provider" className="w-full">
								<SelectValue />
							</SelectTrigger>
							<SelectContent>
								{Array.map(PROVIDERS, value => (
									<SelectItem key={value} value={value}>
										{PROVIDER_NAMES[value]}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</Field>
					<Field>
						<FieldLabel htmlFor="ai-secret">Key</FieldLabel>
						<Input
							id="ai-secret"
							type="password"
							autoComplete="off"
							required
							autoFocus
							value={secret}
							disabled={waiting}
							onChange={event => setSecret(event.target.value)}
						/>
					</Field>
					<ResultError result={result} />
					<DialogFooter>
						<DialogClose render={<Button variant="ghost" type="button" disabled={waiting} />}>Cancel</DialogClose>
						<Button type="submit" disabled={waiting || secret === ''}>
							{Boolean.match(waiting, {onFalse: () => 'Save key', onTrue: () => 'Saving…'})}
						</Button>
					</DialogFooter>
				</form>
			</DialogContent>
		</Dialog>
	)
}
