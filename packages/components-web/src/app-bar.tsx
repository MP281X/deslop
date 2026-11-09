import {useAtomValue} from '@effect/atom-react'

import {Array, Effect, Option, Schema, String, pipe} from 'effect'

import {CaretLeftIcon} from '@phosphor-icons/react'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import type {ReactElement, ReactNode} from 'react'

import {Avatar, AvatarFallback, AvatarImage} from '#components/ui/avatar.tsx'
import {Button} from '#components/ui/button.tsx'
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuGroup,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger
} from '#components/ui/dropdown-menu.tsx'
import {Tabs, TabsList, TabsTrigger} from '#components/ui/tabs.tsx'

type Account = typeof Account.Type
// Without an issuer the account is the developer, who cannot sign out.
const Account = Schema.Struct({id: Schema.String, name: Schema.String, signOut: Schema.Boolean})

const accountAtom = Atom.runtime(FetchHttpClient.layer).atom(
	pipe(
		HttpClient.get('/auth/user'),
		Effect.flatMap(HttpClientResponse.filterStatusOk),
		Effect.flatMap(HttpClientResponse.schemaBodyJson(Account))
	)
)

// Signing out goes through Auth, which ends the session every app shares.
function AccountMenu() {
	const account = useAtomValue(accountAtom)
	if (!AsyncResult.isSuccess(account)) return null
	return (
		<DropdownMenu>
			<DropdownMenuTrigger
				aria-label="Account"
				render={<Button variant="ghost" size="icon-sm" className="max-sm:size-11" />}
			>
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
					className="max-sm:h-11"
					disabled={!account.value.signOut}
					render={<a aria-label="Sign out" href={`/auth/sign-out?${new URLSearchParams({next: location.href})}`} />}
				>
					Sign out
				</DropdownMenuItem>
			</DropdownMenuContent>
		</DropdownMenu>
	)
}

// The app's sections as one segmented control in the masthead; `value` names the current one.
export function AppBarTabs(props: {children: ReactNode; value: string}) {
	return (
		<Tabs value={props.value}>
			<TabsList>{props.children}</TabsList>
		</Tabs>
	)
}

// A bar's segmented choice: the stock tabs over one list of options, named for assistive technology.
export function AppBarChoice(props: {
	label: string
	onChange: (value: string) => void
	options: readonly {label: string; value: string}[]
	value: string
}) {
	return (
		<Tabs value={props.value} onValueChange={props.onChange}>
			<TabsList aria-label={props.label}>
				{Array.map(props.options, option => (
					<TabsTrigger key={option.value} value={option.value}>
						{option.label}
					</TabsTrigger>
				))}
			</TabsList>
		</Tabs>
	)
}

// A section the current URL can name: the tab navigates through `render`, a router link.
export function AppBarTab(props: {children: ReactNode; render: ReactElement; value: string}) {
	return (
		<TabsTrigger value={props.value} nativeButton={false} render={props.render}>
			{props.children}
		</TabsTrigger>
	)
}

// The masthead: mark and name, sections, then the controls that choose what the page shows and the page's few actions.
export function AppBar(props: {
	account?: ReactNode
	back?: {label: string; onClick: () => void}
	controls?: ReactNode
	icon: string
	name: string
	tabs?: ReactNode
	title?: string
}) {
	return (
		<header className="bg-background/90 supports-backdrop-filter:bg-background/80 sticky top-0 z-30 flex h-12 shrink-0 items-center gap-4 border-b px-4 backdrop-blur-md">
			{Option.match(Option.fromUndefinedOr(props.title), {
				onNone: () => (
					<a href="/" aria-label={props.name} className="flex shrink-0 items-center gap-2.5 max-sm:h-11">
						<img src={props.icon} alt="" className="pixelated size-6" />
						<span className="font-heading text-sm font-semibold capitalize max-sm:hidden">{props.name}</span>
					</a>
				),
				// The back caret sits on the rows' 16px mark column and the title on their name column, at 44px.
				onSome: title => (
					<div className="flex min-w-0 shrink items-center gap-1">
						{Option.match(Option.fromUndefinedOr(props.back), {
							onNone: () => (
								<a
									href="/"
									aria-label={props.name}
									className="flex size-8 shrink-0 items-center justify-center max-sm:size-11"
								>
									<img src={props.icon} alt="" className="pixelated size-6" />
								</a>
							),
							onSome: back => (
								<Button
									variant="ghost"
									size="icon-sm"
									className="-ml-2 max-sm:-mr-1.5 max-sm:-ml-3.5 max-sm:size-11"
									aria-label={back.label}
									onClick={back.onClick}
								>
									<CaretLeftIcon className="size-4" />
								</Button>
							)
						})}
						<span className="font-heading max-w-48 min-w-0 truncate text-sm font-semibold">{title}</span>
					</div>
				)
			})}
			{props.tabs !== undefined && (
				<nav aria-label="Sections" className="flex shrink-0 items-center">
					{props.tabs}
				</nav>
			)}
			<div className="ml-auto flex shrink-0 items-center gap-2">
				{props.controls}
				{props.account ?? <AccountMenu />}
			</div>
		</header>
	)
}
