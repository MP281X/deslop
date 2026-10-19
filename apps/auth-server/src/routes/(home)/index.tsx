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

// icon.png's 11×18 pixels as vectors, so its outline follows the theme instead of a white box.
function Logo() {
	return (
		<svg viewBox="3 0 11 18" shapeRendering="crispEdges" className="h-6 w-auto shrink-0" role="img" aria-label="Deslop">
			<path
				className="fill-primary"
				d="M12 0h1v1h-1zM11 1h1v1h-1zM10 2h2v1h-2zM9 3h2v1h-2zM8 4h3v1h-3zM7 5h3v1h-3zM6 6h4v1h-4zM5 7h4v1h-4zM4 8h5v1h-5zM3 9h10v1h-10zM8 10h4v1h-4zM7 11h4v1h-4zM7 12h3v1h-3zM6 13h3v1h-3zM6 14h2v1h-2zM5 15h2v1h-2zM5 16h1v1h-1zM4 17h1v1h-1z"
			/>
			<path
				className="fill-foreground"
				d="M13 0h1v1h-1zM3 1h1v1h-1zM7 1h1v1h-1zM12 1h1v1h-1zM6 2h1v1h-1zM12 2h1v1h-1zM5 3h1v1h-1zM11 3h1v1h-1zM4 4h1v1h-1zM11 4h1v1h-1zM10 5h1v1h-1zM10 6h1v1h-1zM9 7h1v1h-1zM9 8h1v1h-1zM13 9h1v1h-1zM12 10h1v1h-1zM11 11h1v1h-1zM10 12h1v1h-1zM9 13h1v1h-1zM8 14h1v1h-1zM12 14h1v1h-1zM7 15h1v1h-1zM11 15h1v1h-1zM6 16h1v1h-1zM10 16h1v1h-1zM5 17h1v1h-1zM13 17h1v1h-1z"
			/>
		</svg>
	)
}

// Lucide has no brand icons; this is GitHub's mark from its Octicons.
function GitHubIcon() {
	return (
		<svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
			<path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
		</svg>
	)
}

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
				<div className="mb-8 flex items-center gap-2.5">
					<Logo />
					<h1 className="text-xl font-semibold">Deslop Auth</h1>
				</div>
				<ol>
					<Step
						number={1}
						status={Boolean.match(Option.isSome(user), {onFalse: () => 'current', onTrue: () => 'done'})}
						title="Sign in"
					>
						{Option.match(user, {
							onNone: () => (
								<a href="/auth/github" className={buttonVariants({className: 'self-start', size: 'lg'})}>
									<GitHubIcon />
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
