import {useAtom, useAtomValue} from '@effect/atom-react'

import {Array, Boolean, Option, pipe} from 'effect'

import {KeyIcon} from '@phosphor-icons/react'
import {getRouteApi} from '@tanstack/react-router'
import {AsyncResult} from 'effect/reactivity'

import {GitHubIcon} from '@deslop/components-web/icons'
import {Button} from '@deslop/components-web/ui/button'
import {FieldError} from '@deslop/components-web/ui/field'
import {Skeleton} from '@deslop/components-web/ui/skeleton'

import {AppIcon} from '#lib/components.tsx'
import {catalogAtom, codeSignInAtom, passkeySignInAtom, signInAtom} from '#lib/utils.ts'

const route = getRouteApi('/(home)')

export function Failures() {
	const failed = route.useSearch({select: search => search.error !== undefined})
	const [signIn] = useAtom(signInAtom)
	const [codeSignIn] = useAtom(codeSignInAtom)
	const [passkey] = useAtom(passkeySignInAtom)
	return (
		<>
			{Option.match(
				pipe(
					AsyncResult.error(signIn),
					Option.orElse(() => AsyncResult.error(codeSignIn)),
					Option.orElse(() => AsyncResult.error(passkey))
				),
				{onNone: () => null, onSome: failure => <FieldError>{failure.message}</FieldError>}
			)}
			{failed && <FieldError>GitHub sign-in failed. Try again.</FieldError>}
		</>
	)
}

// The suite's apps, as they announced themselves to Auth; each opens its app.
function Suite(props: {apps: readonly {name: string; origin: string}[]}) {
	return (
		<nav aria-label="Apps" className="grid grid-cols-2 gap-x-8 gap-y-3 border-t pt-5">
			{Array.map(props.apps, app => (
				<a
					key={app.origin}
					href={app.origin}
					className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-2.5 max-sm:h-11"
				>
					<AppIcon origin={app.origin} />
					<span className="truncate">{app.name}</span>
				</a>
			))}
		</nav>
	)
}

// The app list's place while its catalog loads, at the loaded suite's geometry.
function SuiteSkeleton() {
	return (
		<div aria-busy="true" aria-label="Apps" role="status" className="grid grid-cols-2 gap-x-8 gap-y-3 border-t pt-5">
			{Array.map(Array.range(1, 4), row => (
				<span key={row} className="flex h-6 min-w-0 items-center gap-2.5 max-sm:h-11">
					<Skeleton className="size-4 shrink-0" />
					<Skeleton className="h-3 w-20" />
				</span>
			))}
		</div>
	)
}

function SignIn() {
	const catalog = useAtomValue(catalogAtom)
	const apps = AsyncResult.getOrElse(catalog, () => [])
	const next = route.useSearch({select: search => search.next})
	const [signIn, startSignIn] = useAtom(signInAtom)
	const [codeSignIn, startCodeSignIn] = useAtom(codeSignInAtom)
	const [passkey, startPasskey] = useAtom(passkeySignInAtom)
	return (
		<section
			className="m-auto flex w-full -translate-y-2 flex-col gap-5 sm:max-w-80 lg:-translate-y-3"
			aria-label="Sign in"
		>
			<h1 className="sr-only">Sign in</h1>
			<div className="flex flex-col gap-2">
				<Button
					size="lg"
					className="w-full max-sm:h-11"
					disabled={AsyncResult.isWaiting(signIn)}
					onClick={() => startSignIn()}
				>
					<GitHubIcon />
					Continue with GitHub
				</Button>
				<Button
					size="lg"
					variant="outline"
					className="w-full max-sm:h-11"
					disabled={AsyncResult.isWaiting(passkey)}
					onClick={() => startPasskey(next)}
				>
					<KeyIcon />
					Continue with a passkey
				</Button>
				<Button
					size="lg"
					variant="ghost"
					className="w-full max-sm:h-11"
					disabled={AsyncResult.isWaiting(codeSignIn)}
					onClick={() => startCodeSignIn(next)}
				>
					Use a sign-in code
				</Button>
				<Failures />
			</div>
			{Boolean.match(AsyncResult.isInitial(catalog), {
				onFalse: () => Array.isReadonlyArrayNonEmpty(apps) && <Suite apps={apps} />,
				onTrue: () => <SuiteSkeleton />
			})}
		</section>
	)
}

// A known signed-out account sees the sign-in page at once; only its app list waits for the catalog.
export function SignedOut() {
	return <SignIn />
}
