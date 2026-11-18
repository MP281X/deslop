import {useAtom, useAtomSet} from '@effect/atom-react'

import {Boolean, Function, Option, Redacted, Schema, String} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {ResultError} from '@deslop/components-web/blocks/result-error'
import {Button} from '@deslop/components-web/ui/button'
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle
} from '@deslop/components-web/ui/dialog'
import {Field, FieldError, FieldGroup, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'

import {pastedKeyAtom, setKeyAtom} from '#lib/gateway.ts'
import {AiKeySecret, KEY_MESSAGE} from '#services/ai-proxy/schema.ts'

// Mounted only while a pasted key waits: closing or saving unmounts it, and its copy of the key with it.
export function AddKeyDialog(props: {initialSecret: string}) {
	const [result, save] = useAtom(setKeyAtom)
	const dismiss = useAtomSet(pastedKeyAtom)
	const [secret, setSecret] = useState(props.initialSecret)
	const waiting = AsyncResult.isWaiting(result)
	const invalidKey = String.isNonEmpty(String.trim(secret)) && !Schema.is(AiKeySecret)(String.trim(secret))
	return (
		<Dialog
			open
			onOpenChange={open => {
				if (!open) dismiss(Option.none())
			}}
		>
			<DialogContent showCloseButton={false}>
				<form
					onSubmit={event => {
						event.preventDefault()
						if (invalidKey) return
						save({secret: Redacted.make(String.trim(secret))})
					}}
				>
					<FieldGroup>
						<DialogHeader>
							<DialogTitle>AI key</DialogTitle>
						</DialogHeader>
						<Field data-invalid={invalidKey}>
							<FieldLabel htmlFor="ai-secret">OpenCode, Anthropic or OpenAI key</FieldLabel>
							<Input
								id="ai-secret"
								type="password"
								aria-invalid={invalidKey}
								aria-describedby="ai-secret-error"
								autoComplete="off"
								autoFocus
								required
								placeholder="oc_sk_…, sk-ant-… or sk-proj-…"
								value={secret}
								disabled={waiting}
								onChange={event => setSecret(event.target.value)}
							/>
							{invalidKey && <FieldError id="ai-secret-error">{KEY_MESSAGE}</FieldError>}
						</Field>
						<ResultError result={result} />
						<DialogFooter>
							<DialogClose render={<Button variant="outline" type="button" disabled={waiting} />}>Cancel</DialogClose>
							<Button type="submit" disabled={waiting || invalidKey}>
								{Boolean.match(waiting, {onFalse: Function.constant('Save'), onTrue: Function.constant('Saving…')})}
							</Button>
						</DialogFooter>
					</FieldGroup>
				</form>
			</DialogContent>
		</Dialog>
	)
}
