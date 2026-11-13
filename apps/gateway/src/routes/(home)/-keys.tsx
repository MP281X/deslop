import {useAtom} from '@effect/atom-react'

import {Boolean, Option, Redacted, Schema, String, pipe} from 'effect'

import {AsyncResult} from 'effect/reactivity'
import {useState} from 'react'

import {Loaded} from '@deslop/components-web/fallbacks'
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
import {Field, FieldError, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Opencode} from '@deslop/components-web/ui/svgs/opencode'
import {OpencodeDark} from '@deslop/components-web/ui/svgs/opencodeDark'

import {aiKeyAtom, setKeyAtom} from '#lib/gateway.ts'
import {CONNECTION_MESSAGE, ConnectionUrl, KEY_MESSAGE, ServiceAccountKey} from '#services/ai-proxy/schema.ts'

export function ProviderMark() {
	return <ThemedMark light={Opencode} dark={OpencodeDark} className="size-4" />
}

export function AddKeyDialog(props: {
	onOpenChange: (open: boolean) => void
	open: boolean
	secret: string
	url: string
}) {
	const [result, save] = useAtom(setKeyAtom)
	// oxlint-disable-next-line react-doctor/no-derived-useState -- Each opening remounts with the pasted key or Console API URL.
	const [secret, setSecret] = useState(props.secret)
	// oxlint-disable-next-line react-doctor/no-derived-useState -- Each opening remounts with the pasted key or Console API URL.
	const [url, setUrl] = useState(props.url)
	const waiting = AsyncResult.isWaiting(result)
	const invalidKey = String.isNonEmpty(String.trim(secret)) && !Schema.is(ServiceAccountKey)(String.trim(secret))
	const invalidUrl = String.isNonEmpty(String.trim(url)) && !Schema.is(ConnectionUrl)(String.trim(url))
	return (
		<Dialog open={props.open && !AsyncResult.isSuccess(result)} onOpenChange={props.onOpenChange}>
			<DialogContent showCloseButton={false}>
				<Loaded atom={aiKeyAtom}>
					{key => (
						<form
							className="flex flex-col gap-4"
							onSubmit={event => {
								event.preventDefault()
								if (invalidKey || invalidUrl) return
								save({
									payload: {
										connectionUrl: Option.liftPredicate(String.trim(url), String.isNonEmpty),
										secret: pipe(
											String.trim(secret),
											Option.liftPredicate(String.isNonEmpty),
											Option.map(Redacted.make)
										)
									},
									reactivityKeys: ['aiKey']
								})
							}}
						>
							<DialogHeader>
								<DialogTitle>OpenCode</DialogTitle>
							</DialogHeader>
							<Field data-invalid={invalidKey}>
								<FieldLabel htmlFor="ai-secret">Service account key</FieldLabel>
								<Input
									id="ai-secret"
									type="password"
									aria-invalid={invalidKey}
									aria-describedby="ai-secret-error"
									autoComplete="off"
									autoFocus
									required={Option.isNone(key)}
									placeholder={Option.match(key, {
										onNone: () => 'OpenCode Console service account key',
										onSome: current => `Leave empty to keep …${current.last4}`
									})}
									value={secret}
									disabled={waiting}
									onChange={event => setSecret(event.target.value)}
								/>
								{invalidKey && <FieldError id="ai-secret-error">{KEY_MESSAGE}</FieldError>}
							</Field>
							<Field data-invalid={invalidUrl}>
								<FieldLabel htmlFor="ai-connection">Anthropic Console API URL</FieldLabel>
								<Input
									id="ai-connection"
									type="text"
									aria-invalid={invalidUrl}
									aria-describedby="ai-connection-error"
									value={url}
									disabled={waiting}
									placeholder={pipe(
										key,
										Option.flatMap(current => current.connectionUrl),
										Option.getOrElse(() => 'https://opencode.ai/inference/custom/conn_…')
									)}
									onChange={event => setUrl(event.target.value)}
								/>
								{invalidUrl && <FieldError id="ai-connection-error">{CONNECTION_MESSAGE}</FieldError>}
							</Field>
							<ResultError result={result} />
							<DialogFooter>
								<DialogClose render={<Button variant="ghost" type="button" disabled={waiting} />}>Cancel</DialogClose>
								<Button type="submit" disabled={waiting || invalidKey || invalidUrl}>
									{Boolean.match(waiting, {onFalse: () => 'Save', onTrue: () => 'Saving…'})}
								</Button>
							</DialogFooter>
						</form>
					)}
				</Loaded>
			</DialogContent>
		</Dialog>
	)
}
