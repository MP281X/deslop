import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Boolean, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {Check, Copy, LoaderCircle, LogOut} from 'lucide-react'
import {useState, type ReactNode} from 'react'

import {Button, buttonVariants} from '@deslop/components-web/ui/button'
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput} from '@deslop/components-web/ui/input-group'
import {toast} from '@deslop/components-web/ui/sonner'

import {apiKeyAtom, meAtom} from '#lib/utils.ts'

export const Route = createFileRoute('/(home)/')({component: Home})

function Step(props: {children?: ReactNode; number: number; status: 'current' | 'done' | 'next'; title: string}) {
	return (
		<li
			className="group relative flex gap-4 pb-7 last:pb-0"
			data-status={props.status}
			aria-current={Boolean.match(props.status === 'current', {onFalse: () => false, onTrue: () => 'step' as const})}
		>
			<span className="absolute top-8 bottom-1 left-3 border-l group-last:hidden" aria-hidden="true" />
			<span
				className="text-muted-foreground group-data-[status=current]:text-foreground group-data-[status=current]:border-foreground grid size-6 shrink-0 place-items-center border text-xs group-data-[status=done]:border-transparent"
				aria-hidden="true"
			>
				{Boolean.match(props.status === 'done', {
					onFalse: () => props.number,
					onTrue: () => <Check className="size-4" />
				})}
			</span>
			<div className="flex min-w-0 flex-1 flex-col gap-3 pt-1">
				<h2 className="text-muted-foreground group-data-[status=current]:text-foreground text-sm font-medium">
					{props.title}
				</h2>
				{props.children}
			</div>
		</li>
	)
}

function Home() {
	const [apiKey, createApiKey] = useAtom(apiKeyAtom)
	const [copied, setCopied] = useState(false)
	const user = useAtomSuspense(meAtom).value
	const key = AsyncResult.value(apiKey)
	return (
		<main className="flex flex-1 justify-center overflow-y-auto px-6 py-10 md:py-24">
			<div className="w-full max-w-md">
				<h1 className="mb-8 text-xl font-semibold">Deslop Auth</h1>
				<ol>
					<Step
						number={1}
						status={Boolean.match(Option.isSome(user), {onFalse: () => 'current', onTrue: () => 'done'})}
						title="Sign in"
					>
						{Option.match(user, {
							onNone: () => (
								<a href="/auth/github" className={buttonVariants({className: 'self-start', size: 'lg'})}>
									Sign in with GitHub
								</a>
							),
							onSome: account => (
								<div className="-mt-1 flex min-w-0 items-center justify-between gap-2">
									<p className="min-w-0 truncate text-sm">{account.name}</p>
									<form method="post" action="/auth/sign-out">
										<Button type="submit" variant="ghost" size="icon-lg" aria-label="Sign out">
											<LogOut />
										</Button>
									</form>
								</div>
							)
						})}
					</Step>
					<Step
						number={2}
						status={Boolean.match(Option.isNone(user), {
							onFalse: () => Boolean.match(Option.isSome(key), {onFalse: () => 'current', onTrue: () => 'done'}),
							onTrue: () => 'next'
						})}
						title="API key"
					>
						{Option.isSome(user) &&
							Option.match(key, {
								onNone: () => (
									<>
										{Option.match(AsyncResult.error(apiKey), {
											onNone: () => null,
											onSome: error => (
												<p className="text-destructive text-sm" role="alert">
													Cannot create an API key: {error.message}
												</p>
											)
										})}
										<Button
											size="lg"
											className="self-start"
											disabled={AsyncResult.isWaiting(apiKey)}
											onClick={() => createApiKey()}
										>
											{AsyncResult.isWaiting(apiKey) && <LoaderCircle className="motion-safe:animate-spin" />}Create API
											key
										</Button>
									</>
								),
								onSome: value => (
									<InputGroup>
										<InputGroupInput readOnly value={value} aria-label="API key" />
										<InputGroupAddon align="inline-end">
											<InputGroupButton
												size="icon-xs"
												aria-label={Boolean.match(copied, {onFalse: () => 'Copy API key', onTrue: () => 'Copied'})}
												onClick={async () => {
													try {
														await navigator.clipboard.writeText(value)
														setCopied(true)
													} catch {
														toast.error('Cannot copy the API key. Select and copy it from the field.')
													}
												}}
											>
												{Boolean.match(copied, {onFalse: () => <Copy />, onTrue: () => <Check />})}
											</InputGroupButton>
											{copied && (
												<span className="sr-only" role="status">
													Copied
												</span>
											)}
										</InputGroupAddon>
									</InputGroup>
								)
							})}
					</Step>
					<Step
						number={3}
						status={Boolean.match(Option.isSome(key), {onFalse: () => 'next', onTrue: () => 'current'})}
						title="Command line"
					>
						{Option.isSome(key) && (
							<p className="text-muted-foreground text-sm">
								Shown once. Save it with your app’s{' '}
								<code className="text-foreground bg-muted px-1">login &lt;key&gt;</code> command.
							</p>
						)}
					</Step>
				</ol>
			</div>
		</main>
	)
}
