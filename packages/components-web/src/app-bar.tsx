import {useAtomValue} from '@effect/atom-react'

import {Effect, Schema, String, pipe} from 'effect'

import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ReactNode} from 'react'

import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '#components/ui/dropdown-menu.tsx'

type Account = typeof Account.Type
// The signed-in account every Deslop server answers at /auth/user; without an issuer it is the developer, who cannot sign out.
const Account = Schema.Struct({id: Schema.String, name: Schema.String, signOut: Schema.Boolean})

const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(
	pipe(
		HttpClient.get('/auth/user'),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Account))
	)
)

// GitHub's avatar for the account; signing out goes through Auth, which ends the session every app shares.
function AccountMenu() {
	const account = useAtomValue(accountAtom)
	if (!AsyncResult.isSuccess(account)) return null
	return (
		<DropdownMenu>
			<DropdownMenuTrigger aria-label="Account">
				<Avatar size="sm">
					<AvatarImage
						src={`https://avatars.githubusercontent.com/u/${String.replace('github:', '')(account.value.id)}?s=96`}
						alt={account.value.name}
					/>
					<AvatarFallback>{String.toUpperCase(String.slice(0, 1)(account.value.name))}</AvatarFallback>
				</Avatar>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="end" className="w-auto min-w-48">
				<DropdownMenuGroup>
					<DropdownMenuLabel>@{account.value.name}</DropdownMenuLabel>
				</DropdownMenuGroup>
				<DropdownMenuSeparator />
				<DropdownMenuItem
					variant="destructive"
					disabled={!account.value.signOut}
					render={<a aria-label="Sign out" href={`/auth/sign-out?${new URLSearchParams({next: location.href})}`} />}
				>
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// At 32px a 64-cell mark lands on whole device pixels of a 2x screen. `account` replaces the shared menu, as Auth's own does.
export function AppBar(props: {account?: ReactNode; children?: ReactNode; icon: string; name: string}) {
	return (
		<header className="bg-background border-border sticky top-0 z-30 flex h-12 shrink-0 items-center justify-between gap-4 border-b px-4">
			<a href="/" className="-ml-1 flex shrink-0 items-center gap-1.5">
				<img src={props.icon} alt="" className="pixelated size-8" />
				<span className="font-mono text-sm font-medium">{props.name}</span>
			</a>
			<div className="flex min-w-0 items-center gap-3">
				{props.children}
				{props.account ?? <AccountMenu />}
			</div>
		</header>
	)
}
