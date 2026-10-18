import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {CopyIcon} from 'lucide-react'

import {Button, buttonVariants} from '@deslop/components-web/ui/button'
import {InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput} from '@deslop/components-web/ui/input-group'

import {apiKeyAtom, meAtom} from '#lib/utils.ts'

export const Route = createFileRoute('/(home)/')({component: Home})

function Home() {
	const [apiKey, createApiKey] = useAtom(apiKeyAtom)
	return (
		<main className="flex flex-1 flex-col items-center justify-center gap-4 p-6">
			{Option.match(useAtomSuspense(meAtom).value, {
				onNone: () => (
					<a href="/auth/github" className={buttonVariants({size: 'lg'})}>
						Sign in with GitHub
					</a>
				),
				onSome: user => (
					<div className="flex w-full max-w-md flex-col gap-4">
						<div className="flex items-center justify-between gap-2">
							<p className="text-sm">
								Signed in as <span className="font-medium">{user.name}</span>
							</p>
							<form method="post" action="/auth/sign-out">
								<Button type="submit" variant="outline">
									Sign out
								</Button>
							</form>
						</div>
						{Option.match(AsyncResult.value(apiKey), {
							onNone: () => (
								<Button disabled={AsyncResult.isWaiting(apiKey)} onClick={() => createApiKey()}>
									Create API key
								</Button>
							),
							onSome: key => (
								<div className="flex flex-col gap-2">
									<InputGroup>
										<InputGroupInput readOnly value={key} aria-label="API key" />
										<InputGroupAddon align="inline-end">
											<InputGroupButton
												size="icon-xs"
												aria-label="Copy the API key"
												onClick={() => navigator.clipboard.writeText(key)}
											>
												<CopyIcon />
											</InputGroupButton>
										</InputGroupAddon>
									</InputGroup>
									<p className="text-muted-foreground text-sm">
										Shown once. Save it with <code>stash login &lt;key&gt;</code>.
									</p>
								</div>
							)
						})}
					</div>
				)
			})}
		</main>
	)
}
