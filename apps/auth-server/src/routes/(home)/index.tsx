import {useAtom, useAtomSuspense} from '@effect/atom-react'

import {Array, Boolean, Option} from 'effect'

import {createFileRoute} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'
import {LoaderCircle, LogOut} from 'lucide-react'

import {Button} from '@deslop/components-web/ui/button'

import {consentAtom, meAtom, requestAtom, signInAtom, signOutAtom} from '#lib/utils.ts'

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

function Home() {
	const user = useAtomSuspense(meAtom).value
	const request = useAtomSuspense(requestAtom).value
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [signOut, endSession] = useAtom(signOutAtom)
	const [consent, respond] = useAtom(consentAtom)
	const error = Option.orElse(AsyncResult.error(signIn), () =>
		Option.orElse(AsyncResult.error(consent), () => AsyncResult.error(signOut))
	)
	return (
		<main className="flex flex-1 justify-center overflow-y-auto px-6 py-10 md:py-24">
			<div className="flex w-full max-w-md flex-col gap-6">
				<div className="flex items-center gap-2.5">
					<Logo />
					<h1 className="text-xl font-semibold">Deslop Auth</h1>
				</div>
				{Option.match(user, {
					onNone: () => (
						<Button size="lg" disabled={AsyncResult.isWaiting(signIn)} onClick={() => startSignIn()}>
							{Boolean.match(AsyncResult.isWaiting(signIn), {
								onFalse: () => <GitHubIcon />,
								onTrue: () => <LoaderCircle className="motion-safe:animate-spin" />
							})}
							Sign in with GitHub
						</Button>
					),
					onSome: account => (
						<>
							{Option.match(request, {
								onNone: () => (
									<>
										<div className="flex items-center justify-between gap-2 border-y py-3">
											<p className="min-w-0 truncate text-sm">{account.name}</p>
											<Button
												variant="ghost"
												size="icon-lg"
												aria-label="Sign out"
												disabled={AsyncResult.isWaiting(signOut)}
												onClick={() => endSession()}
											>
												<LogOut />
											</Button>
										</div>
										<p className="text-muted-foreground text-sm">
											Open an app or connect its MCP URL. Sign-in and authorization happen here automatically.
										</p>
									</>
								),
								onSome: grant => (
									<>
										<div>
											<h2 className="border-b pb-2 text-sm font-medium">Allow access to Deslop?</h2>
											<dl>
												<div className="grid grid-cols-4 items-start gap-3 border-b py-3">
													<dt className="text-muted-foreground text-xs">Client ID</dt>
													<dd className="col-span-3 min-w-0 text-sm break-all">{grant.clientId}</dd>
												</div>
												<div className="grid grid-cols-4 items-start gap-3 border-b py-3">
													<dt className="text-muted-foreground text-xs">Return to</dt>
													<dd className="col-span-3 min-w-0 text-sm break-all">{grant.redirectUri}</dd>
												</div>
												<div className="grid grid-cols-4 items-start gap-3 border-b py-3">
													<dt className="text-muted-foreground text-xs">Resources</dt>
													<dd className="col-span-3 min-w-0 space-y-1 text-sm break-all">
														{Array.map(grant.resources, resource => (
															<p key={resource}>{resource}</p>
														))}
													</dd>
												</div>
												<div className="grid grid-cols-4 items-center gap-3 border-b py-3">
													<dt className="text-muted-foreground text-xs">Account</dt>
													<dd className="col-span-3 flex min-w-0 items-center justify-between gap-2">
														<p className="min-w-0 truncate text-sm">{account.name}</p>
														<Button
															variant="ghost"
															size="icon-lg"
															aria-label="Sign out"
															disabled={AsyncResult.isWaiting(signOut)}
															onClick={() => endSession()}
														>
															<LogOut />
														</Button>
													</dd>
												</div>
											</dl>
										</div>
										<div className="flex flex-col gap-2">
											<Button size="lg" disabled={AsyncResult.isWaiting(consent)} onClick={() => respond(true)}>
												{AsyncResult.isWaiting(consent) && <LoaderCircle className="motion-safe:animate-spin" />}
												Allow
											</Button>
											<Button
												size="lg"
												variant="outline"
												disabled={AsyncResult.isWaiting(consent)}
												onClick={() => respond(false)}
											>
												Deny
											</Button>
										</div>
									</>
								)
							})}
						</>
					)
				})}
				{Option.match(error, {
					onNone: () => null,
					onSome: failure => (
						<p className="text-destructive text-sm" role="alert">
							{failure.message}
						</p>
					)
				})}
				{new URLSearchParams(location.search).has('error') && (
					<p className="text-destructive text-sm" role="alert">
						Sign-in failed. Sign in with an allowed GitHub account.
					</p>
				)}
			</div>
		</main>
	)
}
