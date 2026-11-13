import {useAtom} from '@effect/atom-react'

import {Boolean, Option, Redacted, String, pipe} from 'effect'

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
import {Field, FieldLabel} from '@deslop/components-web/ui/field'
import {Input} from '@deslop/components-web/ui/input'
import {Opencode} from '@deslop/components-web/ui/svgs/opencode'
import {OpencodeDark} from '@deslop/components-web/ui/svgs/opencodeDark'

import {aiKeyAtom, setKeyAtom} from '#lib/gateway.ts'

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
	return (
		<Dialog open={props.open && !AsyncResult.isSuccess(result)} onOpenChange={props.onOpenChange}>
			<DialogContent showCloseButton={false}>
				<Loaded atom={aiKeyAtom}>
					{key => (
						<form
							className="flex flex-col gap-4"
							onSubmit={event => {
								event.preventDefault()
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
							<Field>
								<FieldLabel htmlFor="ai-secret">Service account key</FieldLabel>
								<Input
									id="ai-secret"
									type="password"
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
							</Field>
							<Field>
								<FieldLabel htmlFor="ai-connection">Anthropic Console API URL</FieldLabel>
								<Input
									id="ai-connection"
									type="url"
									value={url}
									disabled={waiting}
									pattern="https://opencode\.ai/inference/custom/conn_[A-Za-z0-9_-]+"
									placeholder={pipe(
										key,
										Option.flatMap(current => current.connectionUrl),
										Option.getOrElse(() => 'https://opencode.ai/inference/custom/conn_…')
									)}
									onChange={event => setUrl(event.target.value)}
								/>
							</Field>
							<ResultError result={result} />
							<DialogFooter>
								<DialogClose render={<Button variant="ghost" type="button" disabled={waiting} />}>Cancel</DialogClose>
								<Button type="submit" disabled={waiting}>
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
