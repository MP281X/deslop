import {useAtomValue} from '@effect/atom-react'

import {Effect, Option, Schema, String, pipe} from 'effect'

import {CaretLeftIcon, MagnifyingGlassIcon} from '@phosphor-icons/react'
import {FetchHttpClient, HttpClient, HttpClientResponse} from 'effect/http'
import {AsyncResult, Atom} from 'effect/reactivity'
import {useEffect, useState} from 'react'
import type {ReactElement, ReactNode} from 'react'

import {CommandPalette} from '#components/command-palette.tsx'
import type {PaletteGroup} from '#components/command-palette.tsx'
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
import {InputGroup, InputGroupAddon, InputGroupInput} from '#components/ui/input-group.tsx'
import {Kbd} from '#components/ui/kbd.tsx'
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

// A section the current URL can name: the tab navigates through `render`, a router link.
export function AppBarTab(props: {children: ReactNode; render: ReactElement; value: string}) {
	return (
		<TabsTrigger value={props.value} nativeButton={false} render={props.render}>
			{props.children}
		</TabsTrigger>
	)
}

// The page-wide search is a field-shaped button that opens the palette; a phone gets its icon alone.
function SearchTrigger(props: {label: string; onClick: () => void}) {
	return (
		<>
			<InputGroup className="absolute left-1/2 hidden w-80 -translate-x-1/2 xl:flex">
				<InputGroupInput
					readOnly
					aria-label={props.label}
					aria-haspopup="dialog"
					placeholder="Search or jump to…"
					onClick={props.onClick}
					onKeyDown={event => {
						if (event.key === 'Enter' || event.key === ' ') props.onClick()
					}}
				/>
				<InputGroupAddon>
					<MagnifyingGlassIcon />
				</InputGroupAddon>
				<InputGroupAddon align="inline-end">
					<Kbd>⌘K</Kbd>
				</InputGroupAddon>
			</InputGroup>
			<Button
				variant="ghost"
				size="icon-sm"
				aria-label={props.label}
				onClick={props.onClick}
				className="max-sm:size-11 xl:hidden"
			>
				<MagnifyingGlassIcon />
			</Button>
		</>
	)
}

export function AppBar(props: {
	account?: ReactNode
	back?: {label: string; onClick: () => void}
	controls?: ReactNode
	icon: string
	name: string
	palette?: readonly PaletteGroup[]
	tabs?: ReactNode
	title?: string
}) {
	const [paletteOpen, setPaletteOpen] = useState(false)
	useEffect(() => {
		if (props.palette === undefined) return
		function open(event: KeyboardEvent) {
			if (event.key !== 'k' || !(event.metaKey || event.ctrlKey)) return
			event.preventDefault()
			setPaletteOpen(true)
		}
		addEventListener('keydown', open)
		return () => removeEventListener('keydown', open)
	}, [props.palette])
	return (
		<>
			<header className="bg-background/90 supports-backdrop-filter:bg-background/80 relative sticky top-0 z-30 flex h-12 shrink-0 items-center gap-4 border-b px-4 backdrop-blur-md">
				{Option.match(Option.fromUndefinedOr(props.title), {
					onNone: () => (
						<a href="/" aria-label={props.name} className="flex shrink-0 items-center gap-2.5 max-sm:h-11">
							<img src={props.icon} alt="" className="pixelated size-6" />
							<span className="font-heading text-sm font-semibold capitalize max-sm:hidden">{props.name}</span>
						</a>
					),
					// The leading slot keeps its width on every pane, so the title and the right controls never move.
					onSome: title => (
						<div className="flex min-w-0 shrink items-center gap-1.5">
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
										className="max-sm:size-11"
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
				<div className="flex min-w-0 flex-1 items-center justify-end max-xl:min-w-11">
					{Option.match(Option.fromUndefinedOr(props.palette), {
						onNone: () => null,
						onSome: () => <SearchTrigger label={`Search ${props.name}`} onClick={() => setPaletteOpen(true)} />
					})}
				</div>
				<div className="flex shrink-0 items-center gap-2">
					{props.controls}
					{props.account ?? <AccountMenu />}
				</div>
			</header>
			{Option.match(Option.fromUndefinedOr(props.palette), {
				onNone: () => null,
				onSome: groups => (
					<CommandPalette current={props.name} groups={groups} open={paletteOpen} onOpenChange={setPaletteOpen} />
				)
			})}
		</>
	)
}
